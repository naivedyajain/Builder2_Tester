import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface EmailSummary {
  seq: number;
  uid?: number;
  date?: string;
  from?: string;
  subject?: string;
  bodySnippet: string;
}

export interface GmailFetchResult {
  success: boolean;
  emails: EmailSummary[];
  totalInbox: number;
  diagnostic?: string;
}

/**
 * Fetch 10 most recent emails from Gmail via IMAP (port 993, SSL)
 * Strictly following the runbook rules:
 * 1. Sanitize password: strip all non A-Za-z0-9 (spaces and \xa0 invisible spaces)
 * 2. Log length (must be 16)
 * 3. Connect to imap.gmail.com:993 with TLS
 * 4. Readonly PEEK: never mark read
 * 5. Fetch sequence numbers max(1, total - 9)..total, newest first
 * 6. Truncate body to ~1000 chars
 * 7. Catch exceptions and return clean "⚠️ Gmail Diagnostic: " + error message
 */
export async function fetchRecentEmails(
  user?: string,
  rawPw?: string
): Promise<GmailFetchResult> {
  const accountUser = (user || process.env.GMAIL_USER || '').trim();
  const rawPassword = rawPw || process.env.GMAIL_APP_PASSWORD || '';

  // Rule 1: Sanitize password (strips spaces and \xa0 invisible chars)
  const sanitizedPw = rawPassword.replace(/[^A-Za-z0-9]/g, '');
  
  // Rule 1 & 7: Log every stage
  console.log('[Gmail Stage] User:', accountUser || '(empty)');
  console.log('[Gmail Stage] Cleaned PW length:', sanitizedPw.length, sanitizedPw.length === 16 ? '(valid 16 chars)' : '(!= 16 chars)');

  if (!accountUser) {
    const diag = '⚠️ Gmail Diagnostic: Missing GMAIL_USER. Please provide your Gmail address in Settings.';
    console.error(diag);
    return { success: false, emails: [], totalInbox: 0, diagnostic: diag };
  }

  if (!sanitizedPw) {
    const diag = '⚠️ Gmail Diagnostic: Missing GMAIL_APP_PASSWORD. Please configure an App Password in Settings.';
    console.error(diag);
    return { success: false, emails: [], totalInbox: 0, diagnostic: diag };
  }

  if (sanitizedPw.length !== 16) {
    const diag = `⚠️ Gmail Diagnostic: Cleaned password length is ${sanitizedPw.length} (MUST be 16). Ensure you are using a 16-character Google App Password (not your normal Gmail password).`;
    console.warn(diag);
  }

  console.log('[Gmail Stage] Connecting to imap.gmail.com:993 (TLS)...');

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: accountUser,
      pass: sanitizedPw,
    },
    logger: false,
    tls: {
      rejectUnauthorized: true,
    },
  });

  try {
    // Stage: Connect and authenticate
    await client.connect();
    console.log('[Gmail Stage] Login successful!');

    // Stage: Select INBOX in read-only mode (Rule 5: NEVER mark read)
    let lock = await client.getMailboxLock('INBOX', { readOnly: true });
    let mailbox = client.mailbox;
    let total = mailbox ? mailbox.exists : 0;

    console.log('[Gmail Stage] Selected INBOX total messages:', total);

    // If INBOX has 0, check [Gmail]/All Mail per Rule 5
    if (total === 0) {
      lock.release();
      try {
        lock = await client.getMailboxLock('[Gmail]/All Mail', { readOnly: true });
        mailbox = client.mailbox;
        total = mailbox ? mailbox.exists : 0;
        console.log('[Gmail Stage] Selected [Gmail]/All Mail total messages:', total);
      } catch {
        // Fallback to empty if All Mail cannot be opened
      }
    }

    if (total === 0) {
      lock.release();
      await client.logout();
      return { success: true, emails: [], totalInbox: 0 };
    }

    // Sequence numbers: max(1, total - 9) .. total (10 most recent)
    const startSeq = Math.max(1, total - 9);
    const endSeq = total;
    const seqRange = `${startSeq}:${endSeq}`;

    console.log(`[Gmail Stage] Fetching sequence range: ${seqRange} (up to 10 newest)...`);

    const messages: EmailSummary[] = [];

    // Fetch messages using sequence range, reading source without modifying flags
    for await (const message of client.fetch(seqRange, {
      envelope: true,
      source: true,
      uid: true,
    })) {
      try {
        if (!message.source) continue;
        const parsed: any = await (simpleParser as any)(message.source);
        const textBody: string = (parsed.text || parsed.html || '').replace(/\s+/g, ' ').trim();
        // Rule 6: Truncate body to ~1000 characters
        const truncatedBody = textBody.length > 1000 ? textBody.slice(0, 1000) + '... [truncated]' : textBody;

        messages.push({
          seq: message.seq,
          uid: message.uid,
          date: parsed.date ? parsed.date.toLocaleString() : message.envelope?.date?.toLocaleString(),
          from: parsed.from?.text || message.envelope?.from?.[0]?.address || 'Unknown',
          subject: parsed.subject || message.envelope?.subject || '(No subject)',
          bodySnippet: truncatedBody || '(No text content)',
        });
      } catch (parseErr) {
        messages.push({
          seq: message.seq,
          uid: message.uid,
          subject: message.envelope?.subject || '(No subject)',
          from: message.envelope?.from?.[0]?.address || 'Unknown',
          bodySnippet: '(Unable to parse message body)',
        });
      }
    }

    lock.release();
    await client.logout();

    // Sort newest first (higher sequence number first)
    messages.sort((a, b) => b.seq - a.seq);

    console.log(`[Gmail Stage] Successfully fetched ${messages.length} messages.`);
    return {
      success: true,
      emails: messages,
      totalInbox: total,
    };
  } catch (err: any) {
    const errorStr = err?.message || String(err);
    console.error('[Gmail Error Stage]:', errorStr);

    let diagnosticNotice = `⚠️ Gmail Diagnostic: ${errorStr}`;

    if (errorStr.includes('AUTHENTICATIONFAILED') || errorStr.includes('Invalid credentials')) {
      diagnosticNotice = `⚠️ Gmail Diagnostic: Authentication Failed. Verify that your 16-character App Password was generated for "${accountUser}" and 2-Step Verification is active on the account.`;
    } else if (errorStr.includes('Please log in via your web browser') || errorStr.includes('IMAP disabled')) {
      diagnosticNotice = `⚠️ Gmail Diagnostic: IMAP is disabled for this account. Go to Gmail Settings → Forwarding and POP/IMAP → Enable IMAP.`;
    }

    return {
      success: false,
      emails: [],
      totalInbox: 0,
      diagnostic: diagnosticNotice,
    };
  }
}
