"use strict";

// Inline styles only — email clients strip external stylesheets and <style> blocks.
function buildTemplate({ title, subtitle, code, codeLabel, footerNote }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
        <!-- Wordmark -->
        <tr>
          <td style="padding:28px 40px 24px;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:18px;font-weight:700;color:#0f172a;letter-spacing:-0.025em;">Bookshelf</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 40px 28px;">
            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;line-height:1.2;">${title}</p>
            <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;">${subtitle}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;text-align:center;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;">${codeLabel}</p>
                  <span style="font-size:32px;font-weight:700;color:#0f172a;letter-spacing:0.12em;word-break:break-all;font-variant-numeric:tabular-nums;">${code}</span>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">${footerNote}</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 40px 24px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;font-size:11px;color:#cbd5e1;">Bookshelf &mdash; You received this because an action was taken on your account.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

exports.handler = async (event) => {
  const code = event.request.codeParameter;

  switch (event.triggerSource) {
    case "CustomMessage_SignUp":
    case "CustomMessage_ResendCode":
      event.response.emailSubject = "Verify your Bookshelf account";
      event.response.emailMessage = buildTemplate({
        title: "Verify your email",
        subtitle:
          "Enter this code to confirm your email address and finish creating your Bookshelf account.",
        code,
        codeLabel: "Verification code",
        footerNote:
          "This code expires in 24 hours. If you didn’t create a Bookshelf account, you can safely ignore this email.",
      });
      break;

    case "CustomMessage_ForgotPassword":
      event.response.emailSubject = "Reset your Bookshelf password";
      event.response.emailMessage = buildTemplate({
        title: "Reset your password",
        subtitle:
          "Enter this code on the reset-password page to set a new password for your account.",
        code,
        codeLabel: "Reset code",
        footerNote:
          "This code expires in 1 hour. If you didn’t request a password reset, you can safely ignore this email.",
      });
      break;

    case "CustomMessage_AdminCreateUser":
      event.response.emailSubject = "You’ve been invited to Bookshelf";
      event.response.emailMessage = buildTemplate({
        title: "You’re invited",
        subtitle:
          "Your Bookshelf account has been created. Sign in with your email and the temporary password below, then set a new password.",
        code,
        codeLabel: "Temporary password",
        footerNote: "You will be asked to create a new password the first time you sign in.",
      });
      break;

    default:
      // Other trigger sources (UpdateUserAttribute, VerifyUserAttribute, etc.) —
      // return unmodified so Cognito applies its built-in template.
      break;
  }

  return event;
};
