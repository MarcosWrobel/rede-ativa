import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import PreviewLandingPage, { metadata } from '../page';
import PreviewLandingClient from '../PreviewLandingClient';
import WorkflowAnimation from '@/components/landing/WorkflowAnimation';
import MasterWorkflowAnimation from '@/components/landing/MasterWorkflowAnimation';

describe('Preview Landing Page & Vector Workflow Animation (/preview-landing)', () => {
  it('garante que a página Server Component possui metadados descritivos corretos', () => {
    expect(metadata.title).toContain('Rede Ativa SaaS');
    expect(metadata.title).toContain('Demonstração');
    expect(metadata.description).toContain('Lei nº 14.063/2020');
  });

  it('renderiza PreviewLandingPage com renderToString com sucesso', () => {
    const html = renderToString(<PreviewLandingPage />);
    expect(html).toContain('Ambiente de Demonstração / Preview Landing Page');
    expect(html).toContain('Rede Ativa');
    expect(html).toContain('Combate à evasão escolar com busca ativa assistida e fé pública probatória');
  });

  it('renderiza PreviewLandingClient com seções Hero, seletor de experiência e CTA para /login', () => {
    const html = renderToString(<PreviewLandingClient />);

    // Top demonstration banner
    expect(html).toContain('Ambiente de Demonstração / Preview Landing Page');
    expect(html).toContain('Modo Claro • Dados Fictícios (LGPD/ECA)');

    // Hero title & CTA
    expect(html).toContain('Combate à evasão escolar com busca ativa assistida e fé pública probatória');
    expect(html).toContain('href="/login"');
    expect(html).toContain('Acessar Plataforma');

    // Seletor de Modo de Demonstração (Fluxo Completo vs Foco Busca Ativa)
    expect(html).toContain('Fluxo Completo (Busca Ativa, Atas e Dossiê)');
    expect(html).toContain('Busca Ativa WhatsApp');

    // 3 Column Benefits
    expect(html).toContain('Disparo Ágil via WhatsApp');
    expect(html).toContain('Linha do Tempo e Prontuário 360º');
    expect(html).toContain('Livro de Atas e Dossiês Oficiais');

    // Legal & Regulatory Backing
    expect(html).toContain('Lei nº 14.063/2020');
    expect(html).toContain('LGPD');
  });

  it('renderiza MasterWorkflowAnimation com os 3 Atos, controles e Ato 1 inicial', () => {
    const html = renderToString(<MasterWorkflowAnimation />);

    // 3 Atos nos Controles Superiores
    expect(html).toContain('1. Busca Ativa WhatsApp');
    expect(html).toContain('2. Livro de Atas &amp; PIN');
    expect(html).toContain('3. Dossiê ECA em 1 Clique');

    // Controles de Reprodução e Posição Inicial
    expect(html).toContain('Ato 1/3');
    expect(html).toContain('Pausar');
    expect(html).toContain('Reiniciar');

    // Conteúdo do Ato 1 (Busca Ativa & SHA-256)
    expect(html).toContain('Lucas M.');
    expect(html).toContain('1º Ano B');
    expect(html).toContain('68%');
    expect(html).toContain('7 faltas seguidas');
    expect(html).toContain('Disparar Notificação WhatsApp');
    expect(html).toContain('SHA-256');

    // Respaldo Legal Probatório
    expect(html).toContain('Lei nº 14.063/2020');
    expect(html).toContain('ECA');
  });

  it('renderiza WorkflowAnimation com os 3 passos operacionais, controles e SVG vetorial', () => {
    const html = renderToString(<WorkflowAnimation />);

    // 3 Steps
    expect(html).toContain('1. Busca Ativa');
    expect(html).toContain('2. Confirmação &amp; Fé Pública');
    expect(html).toContain('3. Prontuário 360º');

    // Controls
    expect(html).toContain('Pausar');
    expect(html).toContain('Reiniciar ciclo');
    expect(html).toContain('Etapa 1/3');

    // Step 1 initial contents (Fictional student, ECA compliance)
    expect(html).toContain('Lucas M.');
    expect(html).toContain('1º Ano B');
    expect(html).toContain('68%');
    expect(html).toContain('7 faltas seguidas');
    expect(html).toContain('Disparar Notificação WhatsApp');
  });

  it('garante que a landing clone opera estritamente no Modo Claro (sem classes dark:)', () => {
    const html = renderToString(<PreviewLandingClient />);
    const darkMatches = html.match(/dark:[a-zA-Z0-9_-]+/g);
    expect(darkMatches).toBeNull();

    const masterHtml = renderToString(<MasterWorkflowAnimation />);
    const darkMasterMatches = masterHtml.match(/dark:[a-zA-Z0-9_-]+/g);
    expect(darkMasterMatches).toBeNull();
  });
});
