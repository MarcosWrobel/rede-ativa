import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import PreviewLandingPage, { metadata } from '../page';
import PreviewLandingClient from '../PreviewLandingClient';
import WorkflowAnimation from '@/components/landing/WorkflowAnimation';
import MasterWorkflowAnimation from '@/components/landing/MasterWorkflowAnimation';

const FORBIDDEN_UI_TERMS = [
  'Fé Pública',
  'fé pública',
  'SHA-256',
  'PBKDF2',
  '100% LGPD',
  'Lei nº 14.063/2020',
  'ISO 19005-1',
  'Imutabilidade',
  'imutável',
  'Inviolável',
  'Impossível rasurar',
  'Sim, plenamente',
  'total respaldo',
  '+38%',
  '~14 horas',
  '5542999999999',
  'Leopoldina',
  'Workflow Operacional',
  'Dossiê Oficial',
  'Certidão',
] as const;

describe('Preview Landing Page & Guardrails de UX Writing (/preview-landing)', () => {
  it('garante metadados descritivos sem jargão técnico ou afirmações jurídicas amplas', () => {
    expect(metadata.title).toContain('Rede Ativa');
    expect(metadata.title).toContain('Demonstração');
    expect(metadata.description).toContain('Simulação demonstrativa');
    expect(metadata.description).toContain('dados fictícios');
    expect(metadata.description).not.toContain('SHA-256');
    expect(metadata.description).not.toContain('Fé Pública');
    expect(metadata.description).not.toContain('Lei nº 14.063/2020');
  });

  it('renderiza PreviewLandingPage com foco no trabalho cotidiano da equipe pedagógica', () => {
    const html = renderToString(<PreviewLandingPage />);
    const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(html).toContain('Ambiente de Demonstração / Preview Landing Page');
    expect(html).toContain('Rede Ativa');
    expect(plainText).toContain(
      'Conecte os contatos com as famílias, os atendimentos e as atas em um único fluxo.'
    );
  });

  it('renderiza PreviewLandingClient com identidade visual da produção, cards enxutos e zero redundância', () => {
    const html = renderToString(<PreviewLandingClient />);
    const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Identidade visual da produção (logo oficial e gradiente do Hero)
    expect(html).toContain('src="/logo.svg"');
    expect(html).toContain('src="/logo-symbol.svg"');
    expect(html).toContain('from-emerald-600 via-teal-600 to-sky-600');

    // Banner e aviso de simulação
    expect(html).toContain('Ambiente de Demonstração / Preview Landing Page');
    expect(html).toContain('Modo Claro • Dados Fictícios');
    expect(html).toContain('Simulação demonstrativa • Dados fictícios');

    // Hero, cards atualizados e CTA
    expect(plainText).toContain(
      'Conecte os contatos com as famílias, os atendimentos e as atas em um único fluxo.'
    );
    expect(html).toContain('supervisão humana');
    expect(html).toContain('Mensagem pronta em 1 clique');
    expect(html).toContain('Atas padronizadas e prontas em instantes');
    expect(html).toContain('Redução da exposição de conversas na tela');
    expect(html).toContain('Relatório de contatos e intervenções');
    expect(html).toContain('href="/login"');
    expect(html).toContain('Acessar sistema');

    // Seletor de visualização
    expect(html).toContain('Fluxo completo');
    expect(html).toContain('Contatos com famílias');

    // 3 Colunas operacionais sem parágrafos repetitivos
    expect(html).toContain('Menos retrabalho na busca ativa e nas atas');
    expect(html).toContain('Contato com famílias sob revisão');
    expect(html).toContain('Histórico contínuo do estudante');
    expect(html).toContain('Atas pedagógicas e relatórios');
    expect(html).toContain('Minuta editável com confirmação de autoria por PIN');
    expect(html).toContain('Correções após confirmação registradas em complemento vinculado');
  });

  it('renderiza MasterWorkflowAnimation com os 3 Atos aderentes aos guardrails', () => {
    const html = renderToString(<MasterWorkflowAnimation />);

    // 3 Atos nos Controles Superiores
    expect(html).toContain('1. Mensagem com revisão');
    expect(html).toContain('2. Ata com confirmação por PIN');
    expect(html).toContain('3. Relatório de histórico');

    // Controles de Reprodução e Posição Inicial
    expect(html).toContain('Ato 1/3');
    expect(html).toContain('Pausar');
    expect(html).toContain('Reiniciar');

    // Conteúdo das telas demonstrativas
    expect(html).toContain('Simulação demonstrativa • Dados fictícios');
    expect(html).toContain('Escola Exemplo • Busca Ativa');
    expect(html).toContain('Lucas M.');
    expect(html).toContain('1º Ano B');
    expect(html).toContain('68%');
    expect(html).toContain('7 faltas seguidas');
    expect(html).toContain('Revisar e enviar');
    expect(html).toContain('Confirmação por PIN:');
    expect(html).toContain('Relatório de Contatos e Intervenções');
    expect(html).toContain('Continuidade sem retrabalho');
  });

  it('renderiza WorkflowAnimation com os 3 passos operacionais sem poluição técnica', () => {
    const html = renderToString(<WorkflowAnimation />);

    expect(html).toContain('1. Preparar mensagem');
    expect(html).toContain('2. Registrar envio');
    expect(html).toContain('3. Histórico do aluno');

    expect(html).toContain('Pausar');
    expect(html).toContain('Reiniciar');
    expect(html).toContain('Etapa 1/3');

    expect(html).toContain('Simulação demonstrativa • Dados fictícios');
    expect(html).toContain('Lucas M.');
    expect(html).toContain('Revisar e enviar');
    expect(html).toContain('Registro de Tentativa de Contato');
  });

  it('garante conformidade com Modo Claro e ausência de termos proibidos pela Seção 10 do GEMINI.md', () => {
    const pageHtml = renderToString(<PreviewLandingClient />);
    const masterHtml = renderToString(<MasterWorkflowAnimation />);
    const simpleHtml = renderToString(<WorkflowAnimation />);

    for (const rendered of [pageHtml, masterHtml, simpleHtml]) {
      expect(rendered.match(/dark:[a-zA-Z0-9_-]+/g)).toBeNull();

      for (const forbidden of FORBIDDEN_UI_TERMS) {
        expect(rendered).not.toContain(forbidden);
      }
    }
  });
});
