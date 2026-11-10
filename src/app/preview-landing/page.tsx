import type { Metadata } from 'next';
import PreviewLandingClient from './PreviewLandingClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Rede Ativa SaaS — Demonstração & Workflow Interativo',
  description:
    'Demonstração interativa do fluxo assistido da Rede Ativa SaaS: Busca Ativa no WhatsApp, confirmação probatória com recibo SHA-256 e prontuário 360º sob a Lei nº 14.063/2020.',
  openGraph: {
    title: 'Rede Ativa SaaS — Demonstração do Workflow Pedagógico',
    description:
      'Simulador visual do fluxo de trabalho operacional: Do alerta de infrequência ao prontuário oficial com Fé Pública.',
    type: 'website',
  },
};

export default function PreviewLandingPage() {
  return <PreviewLandingClient />;
}
