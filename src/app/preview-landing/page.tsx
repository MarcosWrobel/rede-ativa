import type { Metadata } from 'next';
import PreviewLandingClient from './PreviewLandingClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Rede Ativa — Demonstração Interativa',
  description:
    'Simulação demonstrativa com dados fictícios: preparo de mensagens com revisão humana, registro de atas com confirmação de autoria e histórico do estudante.',
  openGraph: {
    title: 'Rede Ativa — Demonstração do Fluxo Pedagógico',
    description:
      'Simulação demonstrativa do acompanhamento escolar: contato com a família, ata de atendimento e relatório de histórico.',
    type: 'website',
  },
};

export default function PreviewLandingPage() {
  return <PreviewLandingClient />;
}
