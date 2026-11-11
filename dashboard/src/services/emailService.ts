import { Resend } from 'resend';
import { env } from '../config/env.js';

export interface AuditReportEmailData {
  id: string;
  targetUrl: string;
  score: number;
  verdict: string;
  summary?: string | null;
  violationsCount?: number;
}

export class EmailService {
  private static resendClient: Resend | null = null;

  private static getClient(): Resend | null {
    if (!this.resendClient && env.RESEND_API_KEY && env.RESEND_API_KEY.trim().length > 0) {
      this.resendClient = new Resend(env.RESEND_API_KEY);
    }
    return this.resendClient;
  }

  /**
   * Envia e-mail com link e token seguro para redefinição de senha (expiração 1h)
   */
  public static async sendPasswordResetEmail(
    to: string,
    resetToken: string,
    userName = 'Usuário'
  ): Promise<{ success: boolean; messageId?: string; mocked?: boolean; error?: string }> {
    const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
    const client = this.getClient();

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #070d1e; color: #f1f5f9; margin: 0; padding: 30px 15px; }
          .container { max-width: 560px; margin: 0 auto; background-color: #0b1329; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .header { text-align: center; border-bottom: 1px solid #1e293b; padding-bottom: 20px; margin-bottom: 24px; }
          .logo { font-size: 22px; font-weight: 900; letter-spacing: 1px; color: #ffffff; }
          .logo-highlight { color: #38bdf8; }
          .badge { display: inline-block; font-size: 11px; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 4px 10px; border-radius: 20px; margin-top: 6px; }
          h2 { color: #ffffff; font-size: 18px; margin-top: 0; }
          p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
          .button-container { text-align: center; margin: 30px 0; }
          .btn { display: inline-block; background: linear-gradient(135deg, #0284c7, #2563eb); color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 10px; box-shadow: 0 4px 15px rgba(2, 132, 199, 0.4); }
          .token-box { background: #070d1e; border: 1px dashed #334155; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 12px; color: #38bdf8; word-break: break-all; margin: 20px 0; }
          .footer { border-top: 1px solid #1e293b; padding-top: 16px; margin-top: 24px; font-size: 11px; color: #64748b; text-align: center; }
          .warning { color: #f59e0b; font-size: 12px; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">CONFORM<span class="logo-highlight">.AI</span></div>
            <div class="badge">SAÚDE & DEONTOLOGIA</div>
          </div>
          <h2>Recuperação de Senha Segura</h2>
          <p>Olá, <strong>${userName}</strong>.</p>
          <p>Recebemos uma solicitação de redefinição de acesso para sua conta no ecossistema Conform.AI. Clique no botão abaixo para cadastrar sua nova senha:</p>
          
          <div class="button-container">
            <a href="${resetUrl}" class="btn">Redefinir Minha Senha</a>
          </div>

          <p class="warning">⚠️ Este link é estritamente confidencial e expira em 1 hora.</p>
          
          <p>Se o botão não funcionar, copie e cole o endereço abaixo no seu navegador:</p>
          <div class="token-box">${resetUrl}</div>

          <p>Caso não tenha solicitado esta alteração, ignore este e-mail. Seus dados continuam protegidos sob a LGPD e nossos protocolos de segurança médica.</p>

          <div class="footer">
            Conform.AI Health • Governança Ética e Regulatória em Saúde (Catálogo Normativo Ativo)<br>
            Mensagem automatizada gerada em conformidade com o Art. 46 da LGPD.
          </div>
        </div>
      </body>
      </html>
    `;

    if (!client) {
      if (env.NODE_ENV === 'test') {
        console.log(`📧 [EmailService:MOCK] Link de recuperação para ${to}: ${resetUrl}`);
        return { success: true, mocked: true };
      }
      console.warn(`⚠️ [EmailService] RESEND_API_KEY ausente. E-mail de redefinição não enviado para ${to}`);
      return { success: false, mocked: true, error: 'Chave RESEND_API_KEY não configurada no ambiente.' };
    }

    try {
      const response = await client.emails.send({
        from: env.EMAIL_FROM,
        to: [to],
        subject: '🔒 Conform.AI — Redefinição de Senha Segura (Válido por 1h)',
        html: htmlContent,
      });

      if (response.error) {
        // Fallback resiliente: se o domínio próprio não foi verificado no Resend, tenta onboarding@resend.dev
        if (
          response.error.message?.toLowerCase().includes('domain is not verified') &&
          !env.EMAIL_FROM.includes('onboarding@resend.dev')
        ) {
          console.warn(`⚠️ [EmailService] Domínio em '${env.EMAIL_FROM}' não está verificado no Resend. Tentando fallback para 'Conform.AI <onboarding@resend.dev>'...`);
          const fallbackRes = await client.emails.send({
            from: 'Conform.AI <onboarding@resend.dev>',
            to: [to],
            subject: '🔒 Conform.AI — Redefinição de Senha Segura (Válido por 1h)',
            html: htmlContent,
          });

          if (!fallbackRes.error && fallbackRes.data?.id) {
            console.log(`📧 [EmailService] E-mail de redefinição enviado via fallback (onboarding@resend.dev) para ${to} | ID: ${fallbackRes.data.id}`);
            return { success: true, messageId: fallbackRes.data.id };
          }
        }

        console.error(`❌ [EmailService] Resend API retornou erro para ${to}:`, response.error);
        return { success: false, error: response.error.message || JSON.stringify(response.error) };
      }

      if (!response.data?.id) {
        return { success: false, error: 'ID da mensagem não retornado pela Resend API.' };
      }

      console.log(`📧 [EmailService] E-mail de redefinição enviado via Resend para ${to} | ID: ${response.data.id}`);
      return { success: true, messageId: response.data.id };
    } catch (err: any) {
      console.error(`❌ [EmailService] Erro ao enviar e-mail via Resend para ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Envia notificação por e-mail com o laudo de conformidade concluído para a clínica
   */
  public static async sendAuditReportCompletedEmail(
    to: string,
    clientName: string,
    report: AuditReportEmailData
  ): Promise<{ success: boolean; messageId?: string; mocked?: boolean; error?: string }> {
    const reportUrl = `${env.FRONTEND_URL}/reports`;
    const client = this.getClient();

    const isConforme = report.verdict === 'CONFORME';
    const isParcial = report.verdict === 'PARCIALMENTE_CONFORME';
    const verdictColor = isConforme ? '#10b981' : isParcial ? '#f59e0b' : '#ef4444';
    const verdictLabel = isConforme
      ? 'CONFORME (Excelente)'
      : isParcial
      ? 'PARCIALMENTE CONFORME (Requer Atenção)'
      : 'NÃO CONFORME (Risco Iminente)';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #070d1e; color: #f1f5f9; margin: 0; padding: 30px 15px; }
          .container { max-width: 580px; margin: 0 auto; background-color: #0b1329; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .header { text-align: center; border-bottom: 1px solid #1e293b; padding-bottom: 20px; margin-bottom: 24px; }
          .logo { font-size: 22px; font-weight: 900; letter-spacing: 1px; color: #ffffff; }
          .logo-highlight { color: #38bdf8; }
          .badge { display: inline-block; font-size: 11px; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 4px 10px; border-radius: 20px; margin-top: 6px; }
          h2 { color: #ffffff; font-size: 18px; margin-top: 0; }
          p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
          .verdict-card { background: #070d1e; border: 1px solid ${verdictColor}; border-radius: 12px; padding: 18px; margin: 20px 0; text-align: center; }
          .verdict-title { font-size: 16px; font-weight: 800; color: ${verdictColor}; }
          .score-text { font-size: 28px; font-weight: 900; color: #ffffff; margin-top: 6px; }
          .meta-table { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13px; }
          .meta-table td { padding: 8px 12px; border-bottom: 1px solid #1e293b; }
          .meta-label { color: #64748b; font-weight: 600; width: 40%; }
          .meta-value { color: #f1f5f9; font-weight: 500; }
          .button-container { text-align: center; margin: 28px 0 10px; }
          .btn { display: inline-block; background: linear-gradient(135deg, #0284c7, #2563eb); color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 10px; box-shadow: 0 4px 15px rgba(2, 132, 199, 0.4); }
          .footer { border-top: 1px solid #1e293b; padding-top: 16px; margin-top: 24px; font-size: 11px; color: #64748b; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">CONFORM<span class="logo-highlight">.AI</span></div>
            <div class="badge">LAUDO DEONTOLÓGICO CONCLUÍDO</div>
          </div>
          <h2>Relatório de Conformidade Regulatória</h2>
          <p>Prezada equipe da clínica <strong>${clientName}</strong>,</p>
          <p>O motor autônomo do Conform.AI finalizou a auditoria do seu canal digital oficial. Segue o panorama da avaliação:</p>
          
          <div class="verdict-card">
            <div class="verdict-title">${verdictLabel}</div>
            <div class="score-text">${report.score}% <span style="font-size: 13px; color: #94a3b8; font-weight: normal;">de Aderência</span></div>
          </div>

          <table class="meta-table">
            <tr>
              <td class="meta-label">Canal Auditado:</td>
              <td class="meta-value">${report.targetUrl}</td>
            </tr>
            <tr>
              <td class="meta-label">Infrações Identificadas:</td>
              <td class="meta-value"><strong>${report.violationsCount ?? 0}</strong> ocorrência(s)</td>
            </tr>
            <tr>
              <td class="meta-label">Marcos Regulatórios:</td>
              <td class="meta-value">Catálogo Normativo Ativo &amp; Deontologia em Saúde</td>
            </tr>
          </table>

          ${report.summary ? `<p style="background: #070d1e; padding: 12px; border-radius: 8px; border-left: 3px solid #38bdf8; font-size: 13px;"><em>"${report.summary}"</em></p>` : ''}

          <div class="button-container">
            <a href="${reportUrl}" class="btn">Visualizar Laudo Completo no Portal</a>
          </div>

          <div class="footer">
            Conform.AI Health • Monitoramento Deontológico 24/7<br>
            Relatório gerado automaticamente e assinado digitalmente pelo auditor de IA.
          </div>
        </div>
      </body>
      </html>
    `;

    if (!client) {
      if (env.NODE_ENV === 'test') {
        console.log(`📧 [EmailService:MOCK] Notificação de laudo para ${to} (Score: ${report.score}%, Veredito: ${report.verdict})`);
        return { success: true, mocked: true };
      }
      console.warn(`⚠️ [EmailService] RESEND_API_KEY ausente. Notificação de laudo não enviada para ${to}`);
      return { success: false, mocked: true, error: 'Chave RESEND_API_KEY não configurada no ambiente. E-mail real não enviado.' };
    }

    try {
      const response = await client.emails.send({
        from: env.EMAIL_FROM,
        to: [to],
        subject: `⚖️ Conform.AI — Laudo Deontológico Concluído [${report.verdict}] (${clientName})`,
        html: htmlContent,
      });

      if (response.error) {
        // Fallback resiliente: se o domínio próprio não foi verificado no Resend, tenta onboarding@resend.dev
        if (
          response.error.message?.toLowerCase().includes('domain is not verified') &&
          !env.EMAIL_FROM.includes('onboarding@resend.dev')
        ) {
          console.warn(`⚠️ [EmailService] Domínio em '${env.EMAIL_FROM}' não está verificado no Resend. Tentando fallback para 'Conform.AI <onboarding@resend.dev>'...`);
          const fallbackRes = await client.emails.send({
            from: 'Conform.AI <onboarding@resend.dev>',
            to: [to],
            subject: `⚖️ Conform.AI — Laudo Deontológico Concluído [${report.verdict}] (${clientName})`,
            html: htmlContent,
          });

          if (!fallbackRes.error && fallbackRes.data?.id) {
            console.log(`📧 [EmailService] Notificação de laudo enviada com sucesso via fallback (onboarding@resend.dev) para ${to} | ID: ${fallbackRes.data.id}`);
            return { success: true, messageId: fallbackRes.data.id };
          }
        }

        console.error(`❌ [EmailService] Resend API retornou erro para ${to}:`, response.error);
        return { success: false, error: response.error.message || JSON.stringify(response.error) };
      }

      if (!response.data?.id) {
        return { success: false, error: 'ID da mensagem não retornado pela Resend API.' };
      }

      console.log(`📧 [EmailService] Notificação de laudo enviada via Resend para ${to} | ID: ${response.data.id}`);
      return { success: true, messageId: response.data.id };
    } catch (err: any) {
      console.error(`❌ [EmailService] Erro ao enviar laudo via Resend para ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  }
}
