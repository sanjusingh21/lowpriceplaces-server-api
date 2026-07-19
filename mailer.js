const nodemailer = require('nodemailer');

// Create transporter using environment variables.
// Fallback to console logging if no SMTP config is present.
const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      service: 'Godaddy',
      host,
      port: parseInt(port || '587', 10),
      // secure: port === '465', // true for 465, false for other ports
      secure: false,
      auth: {
        user,
        pass
      }
    });
  }
  return null;
};

/**
 * Sends a password reset email using the configured SMTP channel.
 * @param {string} toEmail Recipient email address
 * @param {string} resetLink Reset link containing JWT token
 */
const sendResetEmail = async (toEmail, resetLink) => {
  const transporter = getTransporter();
  const senderEmail = process.env.SMTP_FROM || 'support@lowpriceplaces.com';

  if (!transporter) {
    console.log("\n======================================== [MOCK EMAIL] ================");
    console.log(`To: ${toEmail}`);
    console.log(`From: ${senderEmail}`);
    console.log("Subject: Password Reset Request - lowpriceplaces");
    console.log(`Message: You requested a password reset. Click here to reset: ${resetLink}`);
    console.log("=======================================================================\n");
    return;
  }

  const mailOptions = {
    from: `"lowpriceplaces Support" <${senderEmail}>`,
    to: toEmail,
    subject: "Reset Your Password - lowpriceplaces",
    text: `Hello,\n\nYou requested a password reset for your account on lowpriceplaces. Please click the link below to reset your password:\n\n${resetLink}\n\nThis link is valid for 15 minutes.\n\nIf you did not request this, you can safely ignore this email.\n\nRegards,\nThe lowpriceplaces Team`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #6366f1; text-align: center; margin-bottom: 24px;">Reset Your Password</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #334155;">Hello,</p>
        <p style="font-size: 15px; line-height: 1.6; color: #334155;">We received a request to reset the password for your account on <strong>lowpriceplaces</strong>.</p>
        <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">Click the button below to choose a new password. This link is valid for 15 minutes:</p>
        <div style="text-align: center; margin-bottom: 28px;">
          <a href="${resetLink}" style="background-color: #6366f1; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 15px; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p style="font-size: 13px; line-height: 1.6; color: #64748b;">If the button above does not work, copy and paste this link into your browser:</p>
        <p style="font-size: 13px; line-height: 1.6; color: #6366f1; word-break: break-all;">${resetLink}</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 12px; line-height: 1.6; color: #94a3b8; text-align: center;">
          This is an automated message from lowpriceplaces. Please do not reply directly to this email.
        </p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
};

module.exports = {
  sendResetEmail
};
