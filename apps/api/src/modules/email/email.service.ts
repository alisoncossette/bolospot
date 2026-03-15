import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Escape user-controlled strings before interpolating into HTML emails. */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface MeetingInviteData {
  organizerName: string;
  organizerHandle: string;
  meetingTitle: string;
  proposedTime?: string;
  inviteToken: string;
  respondUrl: string;
}

export interface MeetingConfirmationData {
  organizerName: string;
  meetingTitle: string;
  confirmedTime: string;
  duration: number;
  meetingLink?: string;
}

export interface DeclineNotificationData {
  participantName: string;
  participantHandle?: string;
  participantEmail: string;
  meetingTitle: string;
  meetingId: string;
}

export interface NoAvailabilityNotificationData {
  meetingTitle: string;
  meetingId: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  timeRangeStart: number;
  timeRangeEnd: number;
  participantCount: number;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string;
  private readonly emailDomain: string;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('RESEND_API_KEY') || '';
    this.emailDomain = this.configService.get<string>('EMAIL_DOMAIN') || 'bolospot.com';
    this.baseUrl = this.configService.get<string>('APP_URL') || 'https://bolospot.com';
  }

  /**
   * Generate a from address for a user's handle
   * e.g., "Alice <alice@bolospot.com>"
   */
  getHandleEmail(handle: string, displayName?: string): string {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;
    const name = displayName || `@${cleanHandle}`;
    // Display name in email From header — not HTML, but sanitize angle brackets
    const safeName = name.replace(/[<>]/g, '');
    return `${safeName} <${cleanHandle}@${this.emailDomain}>`;
  }

  async sendEmail(options: SendEmailOptions): Promise<EmailResult> {
    const { to, subject, html, text, from, replyTo } = options;
    const defaultFrom = `Bolo <noreply@${this.emailDomain}>`;

    if (!this.apiKey) {
      this.logger.warn('RESEND_API_KEY not configured, email not sent');
      this.logger.debug(`Would have sent email to ${to}: ${subject}`);
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const emailPayload: Record<string, unknown> = {
        from: from || defaultFrom,
        to: [to],
        subject,
        html,
        text: text || this.htmlToText(html),
      };

      if (replyTo) {
        emailPayload.reply_to = replyTo;
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorJson.error || errorText;
        } catch {
          errorMessage = errorText;
        }
        this.logger.error(`Failed to send email to ${to}: ${errorMessage}`);
        return { success: false, error: errorMessage };
      }

      const result = await response.json();
      this.logger.log(`Email sent successfully to ${to} from ${from || defaultFrom}, id: ${result.id}`);
      return { success: true, messageId: result.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error sending email to ${to}: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  async sendMeetingInvite(email: string, data: MeetingInviteData): Promise<EmailResult> {
    const html = this.getMeetingInviteTemplate(data);

    // Send from the organizer's handle email (e.g., tcossette@bolospot.com)
    const fromEmail = this.getHandleEmail(data.organizerHandle, data.organizerName);

    return this.sendEmail({
      to: email,
      from: fromEmail,
      subject: `${data.organizerName} wants to schedule a meeting with you`,
      html,
    });
  }

  async sendMeetingConfirmation(email: string, data: MeetingConfirmationData): Promise<EmailResult> {
    const html = this.getMeetingConfirmationTemplate(data);

    return this.sendEmail({
      to: email,
      subject: `Meeting Confirmed: ${data.meetingTitle}`,
      html,
    });
  }

  async sendDeclineNotification(organizerEmail: string, data: DeclineNotificationData): Promise<EmailResult> {
    const html = this.getDeclineNotificationTemplate(data);

    return this.sendEmail({
      to: organizerEmail,
      subject: `${data.participantName} declined: ${data.meetingTitle}`,
      html,
    });
  }

  async sendNoAvailabilityNotification(organizerEmail: string, data: NoAvailabilityNotificationData): Promise<EmailResult> {
    const html = this.getNoAvailabilityTemplate(data);

    return this.sendEmail({
      to: organizerEmail,
      subject: `No available times found: ${data.meetingTitle}`,
      html,
    });
  }

  async sendOtpEmail(email: string, code: string): Promise<EmailResult> {
    const html = this.getOtpTemplate(code);
    return this.sendEmail({
      to: email,
      subject: `${code} is your Bolo login code`,
      html,
    });
  }

  async sendMagicLinkEmail(email: string, magicLinkUrl: string): Promise<EmailResult> {
    const html = this.getMagicLinkTemplate(magicLinkUrl);
    return this.sendEmail({
      to: email,
      subject: 'Sign in to Bolo',
      html,
    });
  }

  private getOtpTemplate(code: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Bolo Login Code</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Your Login Code</h1>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      Enter this code to sign in to Bolo:
    </p>

    <div style="text-align: center; margin: 24px 0;">
      <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #0369a1; font-family: monospace;">${code}</span>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin-bottom: 20px; text-align: center;">
      This code expires in 5 minutes.
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="font-size: 12px; color: #9ca3af; text-align: center;">
      If you didn't request this code, you can safely ignore this email.<br>
      <a href="${this.baseUrl}" style="color: #0ea5e9;">Bolo</a>
    </p>
  </div>
</body>
</html>
`;
  }

  private getMagicLinkTemplate(magicLinkUrl: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to Bolo</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Sign in to Bolo</h1>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      Click the button below to sign in. This link expires in 15 minutes.
    </p>

    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${magicLinkUrl}"
         style="display: inline-block; background: #0369a1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">
        Sign in to Bolo
      </a>
    </div>

    <p style="font-size: 12px; color: #9ca3af; word-break: break-all;">
      Or copy this link: ${magicLinkUrl}
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="font-size: 12px; color: #9ca3af; text-align: center;">
      If you didn't request this link, you can safely ignore this email.<br>
      <a href="${this.baseUrl}" style="color: #0ea5e9;">Bolo</a>
    </p>
  </div>
</body>
</html>
`;
  }

  private getNoAvailabilityTemplate(data: NoAvailabilityNotificationData): string {
    const formatHour = (hour: number) => {
      if (hour === 0) return '12:00 AM';
      if (hour < 12) return `${hour}:00 AM`;
      if (hour === 12) return '12:00 PM';
      return `${hour - 12}:00 PM`;
    };

    const title = escapeHtml(data.meetingTitle);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>No Available Times Found</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">No Available Times Found</h1>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      All ${data.participantCount} participants have responded, but there's no overlapping availability in the requested time window.
    </p>

    <div style="background: #fffbeb; padding: 20px; border-radius: 8px; margin-bottom: 24px; border: 1px solid #fcd34d;">
      <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #111827;">${title}</h2>
      <p style="margin: 5px 0; color: #92400e;">
        📅 ${data.dateRangeStart} - ${data.dateRangeEnd}
      </p>
      <p style="margin: 5px 0; color: #92400e;">
        🕐 ${formatHour(data.timeRangeStart)} - ${formatHour(data.timeRangeEnd)}
      </p>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin-bottom: 20px;">
      Try expanding the date range or adjusting the preferred hours to find a time that works for everyone.
    </p>

    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${this.baseUrl}/dashboard/meetings"
         style="display: inline-block; background: #f59e0b; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">
        Update Meeting Settings
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="font-size: 12px; color: #9ca3af; text-align: center;">
      This notification was sent via <a href="https://bolospot.com" style="color: #f59e0b;">Bolo</a>
    </p>
  </div>
</body>
</html>
`;
  }

  private getDeclineNotificationTemplate(data: DeclineNotificationData): string {
    const rawDisplayName = data.participantHandle
      ? `${data.participantName} (@${data.participantHandle})`
      : data.participantName || data.participantEmail;
    const displayName = escapeHtml(rawDisplayName);
    const title = escapeHtml(data.meetingTitle);
    const email = escapeHtml(data.participantEmail);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Declined</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Meeting Declined</h1>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      <strong>${displayName}</strong> has declined your meeting invitation.
    </p>

    <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin-bottom: 24px; border: 1px solid #fecaca;">
      <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #111827;">${title}</h2>
      <p style="margin: 0; color: #991b1b;">
        ❌ Declined by ${email}
      </p>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin-bottom: 20px;">
      The meeting will still be scheduled with the remaining participants who have accepted.
    </p>

    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${this.baseUrl}/dashboard/meetings"
         style="display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">
        View Meeting
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="font-size: 12px; color: #9ca3af; text-align: center;">
      This notification was sent via <a href="https://bolospot.com" style="color: #667eea;">Bolo</a>
    </p>
  </div>
</body>
</html>
`;
  }

  private getMeetingConfirmationTemplate(data: MeetingConfirmationData): string {
    const title = escapeHtml(data.meetingTitle);
    const organizer = escapeHtml(data.organizerName);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Confirmed</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Meeting Confirmed!</h1>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      Great news! Your meeting has been scheduled.
    </p>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin-bottom: 24px; border: 1px solid #bbf7d0;">
      <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #111827;">${title}</h2>
      <p style="margin: 5px 0; color: #166534; font-weight: 600;">
        📅 ${data.confirmedTime}
      </p>
      <p style="margin: 5px 0; color: #6b7280;">
        ⏱️ ${data.duration} minutes
      </p>
      ${data.meetingLink ? `
      <p style="margin: 15px 0 0 0;">
        <a href="${data.meetingLink}" style="color: #059669; font-weight: 600;">
          🔗 Join Meeting
        </a>
      </p>
      ` : ''}
    </div>

    <p style="font-size: 14px; color: #6b7280;">
      Organized by <strong>${organizer}</strong>
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="font-size: 12px; color: #9ca3af; text-align: center;">
      This confirmation was sent via <a href="https://bolospot.com" style="color: #10b981;">Bolo</a>
    </p>
  </div>
</body>
</html>
`;
  }

  private getMeetingInviteTemplate(data: MeetingInviteData): string {
    const organizer = escapeHtml(data.organizerName);
    const handle = escapeHtml(data.organizerHandle);
    const title = escapeHtml(data.meetingTitle);
    const proposed = data.proposedTime ? escapeHtml(data.proposedTime) : '';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Meeting Request</h1>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      Hi there,
    </p>

    <p style="font-size: 16px; margin-bottom: 20px;">
      <strong>${organizer}</strong> (@${handle}) wants to schedule a meeting with you:
    </p>

    <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #111827;">${title}</h2>
      ${proposed ? `<p style="margin: 0; color: #6b7280;">Proposed: ${proposed}</p>` : ''}
    </div>

    <p style="font-size: 16px; margin-bottom: 24px;">
      Choose how you'd like to respond:
    </p>

    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${data.respondUrl}?action=connect"
         style="display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 8px;">
        Connect Your Calendar
      </a>
      <br>
      <a href="${data.respondUrl}?action=manual"
         style="display: inline-block; background: #ffffff; color: #667eea; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; border: 2px solid #667eea; margin: 8px;">
        Enter Times Manually
      </a>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
      By connecting your calendar, Bolo will automatically find times when you're both available. Your calendar data stays private - we only check for conflicts.
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="font-size: 12px; color: #9ca3af; text-align: center;">
      This invitation was sent via <a href="https://bolospot.com" style="color: #667eea;">Bolo</a> - the scheduling layer for humans and AI.<br>
      Unsubscribe or manage preferences at any time.
    </p>
  </div>
</body>
</html>
`;
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<style[^>]*>.*<\/style>/gi, '')
      .replace(/<script[^>]*>.*<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}