"use client";

import React, { useState, useId } from "react";
import Link from "next/link";

/* ==============================================================================
   VETORES SVG PRÓPRIOS (DESIGN SYSTEM PROFISSIONAL - STRICT NO EMOJIS)
   ============================================================================== */

function IconScale({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m-9-7l3-6 3 6H3zm12 0l3-6 3 6h-6zM3 14h6m6 0h6m-15 0a3 3 0 006 0m6 0a3 3 0 006 0" />
    </svg>
  );
}

function IconShield({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

function IconLock({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function IconScroll({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function IconChat({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 6.75l3.5-3.5h11a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0016.75 3H4.25A2.25 2.25 0 002 5.25v9a2.25 2.25 0 002.25 2.25h.5v3.25z" />
    </svg>
  );
}

function IconFolder({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h4.125c.621 0 1.125-.504 1.125-1.125V7.5a2.25 2.25 0 012.25-2.25h6a2.25 2.25 0 012.25 2.25v1.125H21A2.25 2.25 0 0123.25 11v6.75A2.25 2.25 0 0121 20H4.5a2.25 2.25 0 01-2.25-2.25v-5z" />
    </svg>
  );
}

function IconDocument({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function IconPhone({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
    </svg>
  );
}

function IconKey({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}

function IconLogin({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H3" />
    </svg>
  );
}

function IconSparkles({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

function IconSignature({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  );
}

function IconSchool({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-5.25 6.557q.53.078 1.056.177m7.444-6.734v3.675" />
    </svg>
  );
}

function IconBuilding({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.5m-15 10.5V10.5M3 21h18M5.25 10.5h13.5" />
    </svg>
  );
}

function IconCheck({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function IconWarning({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function IconSend({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  );
}

function IconQrCode({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5zM6.75 6.75h.008v.008H6.75V6.75zm0 9.75h.008v.008H6.75v-.008zm9.75-9.75h.008v.008h-.008V6.75zm.75 6.75h.008v.008h-.008v-.008zm3 0h.008v.008h-.008v-.008zm-3 3h.008v.008h-.008v-.008zm3 3h.008v.008h-.008v-.008zm-3 3h.008v.008h-.008v-.008z" />
    </svg>
  );
}

function IconClock({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconChevronRight({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function IconEye({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

/* ==============================================================================
   DADOS DE DEMONSTRAÇÃO DO PLAYGROUND INTERATIVO
   ============================================================================== */

interface StudentProfile {
  id: string;
  name: string;
  grade: string;
  absences: number;
  risk: "baixo" | "medio" | "critico" | "recuperado";
  parent: string;
  phone: string;
}

const SAMPLE_STUDENTS: StudentProfile[] = [
  {
    id: "stu-1",
    name: "Lucas Mendes da Silva",
    grade: "8º Ano B",
    absences: 4,
    risk: "medio",
    parent: "Regina Mendes (Mãe)",
    phone: "(42) 99874-1234",
  },
  {
    id: "stu-2",
    name: "Mariana Costa Ribeiro",
    grade: "9º Ano A",
    absences: 11,
    risk: "critico",
    parent: "Carlos Ribeiro (Pai)",
    phone: "(42) 99123-8899",
  },
  {
    id: "stu-3",
    name: "Pedro Henrique Santos",
    grade: "7º Ano C",
    absences: 0,
    risk: "recuperado",
    parent: "Luciana Santos (Mãe)",
    phone: "(42) 99812-4455",
  },
];

type MessageTemplateType = "preventivo" | "critico_eca" | "elogio";

export default function ImpactoClient() {
  const [numStudents, setNumStudents] = useState<number>(650);
  const [numStaff, setNumStaff] = useState<number>(3);
  const [copiedLink, setCopiedLink] = useState(false);

  // Simulador 1: Busca Ativa
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile>(SAMPLE_STUDENTS[0]);
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplateType>("preventivo");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [messageSentSuccess, setMessageSentSuccess] = useState(false);
  const [privacyMode, setPrivacyMode] = useState<"compact" | "exposed">("compact");

  // Simulador 2: Livro de Atas
  const [ataSubject, setAtaSubject] = useState("Reunião de Alinhamento de Rendimento e Frequência");
  const [ataText, setAtaText] = useState(
    "Aos cinco dias do mês de novembro, compareceu a esta coordenação pedagógica a Sra. Regina Mendes..."
  );
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [serverPinVerified, setServerPinVerified] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrSignedStep, setQrSignedStep] = useState<"waiting" | "scanning" | "signed">("waiting");
  const [ataFinalized, setAtaFinalized] = useState(false);

  // Simulador 3: Dossiê ECA
  const [isGeneratingDossier, setIsGeneratingDossier] = useState(false);
  const [dossierProgress, setDossierProgress] = useState(0);
  const [dossierModalOpen, setDossierModalOpen] = useState(false);

  const studentsInputId = useId();
  const staffInputId = useId();

  // ============================================================================
  // CÁLCULOS DINÂMICOS DO GRÁFICO (REAGEM A ALUNOS E EQUIPE)
  // ============================================================================
  // Na rotina manual: horas crescem com o número de alunos (faltas, ligações, atas) e tamanho da equipe
  const manualWeeklyTotal = Math.round((numStaff * 4) + (numStudents * 0.046));
  // Na Rede Ativa: automação por SERE + modelos + IA consome apenas fração mínima de tempo
  const platformWeeklyTotal = Math.max(2, Math.round((numStaff * 1.2) + (numStudents * 0.006)));

  const hoursSavedPerMonth = Math.round((manualWeeklyTotal - platformWeeklyTotal) * 4.3);
  const savingsPercent = Math.max(10, Math.min(92, Math.round(((manualWeeklyTotal - platformWeeklyTotal) / manualWeeklyTotal) * 100)));
  const paperSheetsSavedPerYear = Math.round(numStudents * 3.8);

  // Escala dinâmica para as alturas das colunas no gráfico
  const maxScaleHours = Math.max(60, Math.ceil((manualWeeklyTotal * 1.2) / 10) * 10);
  const manualColHeight = Math.min(96, Math.max(18, Math.round((manualWeeklyTotal / maxScaleHours) * 100)));
  const platformColHeight = Math.min(96, Math.max(10, Math.round((platformWeeklyTotal / maxScaleHours) * 100)));

  // Handlers
  const handlePrint = () => {
    window.print();
  };

  const handleShare = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    }
  };

  const getInterpolatedMessage = () => {
    if (selectedTemplate === "preventivo") {
      return `Olá, responsável por ${selectedStudent.name}! Notamos a ausência do aluno nas últimas aulas do ${selectedStudent.grade} (total de ${selectedStudent.absences} faltas). Como a escola pode auxiliar a família para garantir a presença regular?`;
    }
    if (selectedTemplate === "critico_eca") {
      return `AVISO INSTITUCIONAL URGENTE: Prezado(a) responsável por ${selectedStudent.name} (${selectedStudent.grade}). O estudante acumula ${selectedStudent.absences} faltas não justificadas, aproximando-se do limite estabelecido pelo Art. 56 do ECA. Solicitamos comparecimento à coordenação pedagógica.`;
    }
    return `Parabéns! Notamos a recuperação exemplar de frequência do(a) estudante ${selectedStudent.name} nesta quinzena. Agradecemos o apoio contínuo da família com a escola!`;
  };

  const handleSimulateSend = () => {
    setIsSendingMessage(true);
    setMessageSentSuccess(false);
    setTimeout(() => {
      setIsSendingMessage(false);
      setMessageSentSuccess(true);
    }, 500);
  };

  const handleSimulateAiWriting = () => {
    setIsAiTyping(true);
    setAtaText("");
    const fullText = `Em atendimento pedagógico nesta data, reuniu-se a equipe escolar com ${selectedStudent.parent}, responsável legal pelo estudante ${selectedStudent.name} (${selectedStudent.grade}). Foi apresentado o prontuário contendo ${selectedStudent.absences} faltas não justificadas. A responsável esclareceu as dificuldades de transporte e firmou compromisso de acompanhamento diário com a escola. Orientada quanto aos termos do Art. 56 do Estatuto da Criança e do Adolescente.`;

    let i = 0;
    const interval = setInterval(() => {
      i += 10;
      if (i >= fullText.length) {
        setAtaText(fullText);
        setIsAiTyping(false);
        clearInterval(interval);
      } else {
        setAtaText(fullText.substring(0, i));
      }
    }, 20);
  };

  const handleStartQrSigning = () => {
    setQrModalOpen(true);
    setQrSignedStep("waiting");
    setTimeout(() => {
      setQrSignedStep("scanning");
      setTimeout(() => {
        setQrSignedStep("signed");
        setAtaFinalized(true);
      }, 1200);
    }, 1000);
  };

  const handleGenerateDossier = () => {
    setIsGeneratingDossier(true);
    setDossierProgress(20);
    const step1 = setTimeout(() => setDossierProgress(70), 300);
    const step2 = setTimeout(() => {
      setDossierProgress(100);
      setIsGeneratingDossier(false);
      setDossierModalOpen(true);
    }, 750);
    return () => {
      clearTimeout(step1);
      clearTimeout(step2);
    };
  };

  // WhatsApp oficial para agendamento e demonstração institucional
  // TODO: Inserir número oficial com DDD caso venha de variável de ambiente
  const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "5542999999999";

  const generalWhatsappMsg = encodeURIComponent(
    "Olá! Gostaria de conhecer a Rede Ativa e agendar uma demonstração rápida de 15 minutos para minha escola."
  );
  const generalWhatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${generalWhatsappMsg}`;

  const calculatorWhatsappMsg = encodeURIComponent(
    `Olá! Simulei a redução de horas para uma escola com ${numStudents} estudantes e gostaria de agendar uma demonstração rápida da Rede Ativa.`
  );
  const calculatorWhatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${calculatorWhatsappMsg}`;

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-emerald-100 selection:text-emerald-900 print:bg-white print:text-black">
      {/* ==============================================================================
          1. HEADER INSTITUCIONAL COM LOGO DESTACADO
          ============================================================================== */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-xs print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          {/* Logo Principal em Grande Destaque */}
          <Link href="/" className="flex items-center gap-3.5 group py-1">
            <div className="h-12 w-auto flex items-center justify-center p-1 rounded-xl bg-slate-50/80 border border-slate-200/80 shadow-xs transition-transform group-hover:scale-102">
              <img src="/logo.svg" alt="Rede Ativa - Busca Ativa & Livro de Atas" className="h-10 w-auto object-contain" />
            </div>
            <div className="hidden md:flex flex-col">
              <span className="text-[10px] uppercase font-extrabold tracking-widest text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200/80 self-start">
                Rede Ativa
              </span>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                Plataforma Integrada de Busca Ativa & Atas Digitais
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={handleShare}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 flex items-center gap-1.5 transition-colors shadow-xs"
              title="Copiar link da página"
            >
              {copiedLink ? (
                <>
                  <IconCheck className="w-4 h-4 text-emerald-600" />
                  <span className="text-emerald-700 font-bold">Link Copiado!</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                    />
                  </svg>
                  <span className="hidden sm:inline">Compartilhar</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="hidden lg:flex px-3.5 py-2 text-xs font-semibold rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 items-center gap-1.5 transition-colors shadow-xs"
              title="Salvar como documento em PDF"
            >
              <IconDocument className="w-4 h-4 text-emerald-600" />
              <span>Salvar em PDF</span>
            </button>

            <a
              href={generalWhatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex px-3.5 py-2 text-xs font-semibold rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 items-center gap-1.5 transition-colors"
            >
              <IconPhone className="w-4 h-4 text-emerald-600" />
              <span>Agendar</span>
            </a>

            <Link
              href="/login"
              aria-label="Acessar Plataforma"
              className="px-4.5 py-2.5 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-2 shadow-sm shadow-slate-900/10 transition-all transform hover:-translate-y-0.5"
            >
              <IconLogin className="w-4 h-4 text-emerald-400" />
              <span>Acessar sistema</span>
            </Link>
          </div>
        </div>
      </header>

      {/* ==============================================================================
          2. HERO SECTION COM BRANDING EM ALTO RELEVO & CREDENCIAIS LEGAIS
          ============================================================================== */}
      <section className="relative pt-10 pb-16 md:pt-16 md:pb-24 overflow-hidden border-b border-slate-100 bg-gradient-to-b from-slate-50/80 via-white to-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.15] max-w-4xl mx-auto">
            Busca ativa e atas de atendimento conectadas:{" "}
            <span className="bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 bg-clip-text text-transparent">
              todo o histórico com respaldo jurídico real
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg lg:text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
            Unifique os acionamentos às famílias e a lavratura de atas pedagógicas. Cada contato, deliberação e encaminhamento registrado de forma consistente e segura para instrução de esclarecimentos legais.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href={generalWhatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md shadow-emerald-600/20 flex items-center gap-2.5 transition-all transform hover:-translate-y-0.5"
            >
              <IconPhone className="w-4 h-4" />
              Agendar demonstração no WhatsApp
            </a>
            <a
              href="#calculadora"
              className="px-6 py-3.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm border border-slate-200 shadow-xs flex items-center gap-2 transition-all"
            >
              <IconClock className="w-4 h-4 text-emerald-600" />
              Simular redução de horas
            </a>
          </div>

          {/* Selos de Conformidade Normativa */}
          <div className="mt-12 pt-8 border-t border-slate-200/80 max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-3 text-left">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <IconScale className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900 leading-tight">Lei 14.063/2020</p>
                <p className="text-[11px] text-slate-500">Assinatura Eletrônica Avançada</p>
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-3 text-left">
              <div className="w-9 h-9 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center shrink-0">
                <IconShield className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900 leading-tight">ECA Art. 56</p>
                <p className="text-[11px] text-slate-500">Rastreabilidade de Infrequência</p>
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-3 text-left">
              <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                <IconLock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900 leading-tight">LGPD & ECA 143</p>
                <p className="text-[11px] text-slate-500">Proteção de Dados do Menor</p>
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-3 text-left">
              <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <IconScroll className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900 leading-tight">ISO 19005-1</p>
                <p className="text-[11px] text-slate-500">Arquivo Permanente PDF/A-1b</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==============================================================================
          3. BANCADA INTERATIVA EM GRANDE DESTAQUE VISUAL
          ============================================================================== */}
      <section className="relative bg-gradient-to-r from-emerald-50/90 via-slate-50 to-sky-50/90 border-y-2 border-emerald-300/70 py-6 px-4 sm:px-6 shadow-sm print:hidden">
        <div className="max-w-6xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-5">
          {/* Identificação de Destaque da Bancada */}
          <div className="flex items-center gap-3 text-left">
            <div className="w-12 h-12 rounded-2xl bg-white border border-emerald-200 shadow-sm flex items-center justify-center shrink-0">
              <IconSparkles className="w-6 h-6 text-emerald-600 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-slate-900 tracking-wider uppercase text-xs bg-emerald-100/80 text-emerald-900 px-2.5 py-0.5 rounded-md border border-emerald-300/80">
                  Bancada Interativa
                </span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                  Simule ao Vivo
                </span>
              </div>
              <p className="text-xs text-slate-700 font-semibold mt-0.5">
                Experimente o Fluxo da Sua Escola na Prática:
              </p>
            </div>
          </div>

          {/* Cards de Navegação com Alta Elevação */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto">
            <a
              href="#busca-ativa"
              className="px-4 py-3 rounded-xl bg-white hover:bg-emerald-50/70 text-slate-800 hover:text-emerald-950 font-bold border-2 border-emerald-200/90 transition-all flex items-center gap-2.5 shadow-sm hover:shadow hover:-translate-y-0.5"
            >
              <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <IconChat className="w-4 h-4" />
              </div>
              <div className="text-left leading-tight">
                <span className="text-xs block">1. Busca Ativa & WhatsApp Protegido</span>
                <span className="text-[10px] font-normal text-slate-500">Modo Privacidade</span>
              </div>
            </a>

            <a
              href="#livro-atas"
              className="px-4 py-3 rounded-xl bg-white hover:bg-sky-50/70 text-slate-800 hover:text-sky-950 font-bold border-2 border-sky-200/90 transition-all flex items-center gap-2.5 shadow-sm hover:shadow hover:-translate-y-0.5"
            >
              <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                <IconScroll className="w-4 h-4" />
              </div>
              <div className="text-left leading-tight">
                <span className="text-xs block">2. Livro de Atas & QR Code do Pai</span>
                <span className="text-[10px] font-normal text-slate-500">Fé Pública 14.063</span>
              </div>
            </a>

            <a
              href="#dossie-eca"
              className="px-4 py-3 rounded-xl bg-white hover:bg-teal-50/70 text-slate-800 hover:text-teal-950 font-bold border-2 border-teal-200/90 transition-all flex items-center gap-2.5 shadow-sm hover:shadow hover:-translate-y-0.5"
            >
              <div className="w-7 h-7 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center shrink-0">
                <IconFolder className="w-4 h-4" />
              </div>
              <div className="text-left leading-tight">
                <span className="text-xs block">3. Dossiê ECA em 1 Clique</span>
                <span className="text-[10px] font-normal text-slate-500">PDF/A em 30 seg</span>
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* ==============================================================================
          4. SEÇÃO 1: ZIGUEZAGUE - BUSCA ATIVA & WHATSAPP PROTEGIDO
          ============================================================================== */}
      <section id="busca-ativa" className="py-16 md:py-24 border-b border-slate-100 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Texto Descritivo */}
            <div className="lg:col-span-5 space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-bold border border-emerald-200/80">
                <IconPhone className="w-3.5 h-3.5" />
                Módulo 1: Comunicação Humanizada
              </div>

              <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                Busca Ativa Humanizada com Janela Protegida
              </h2>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                Usar o WhatsApp pessoal no computador da escola costuma ser arriscado: a tela aberta expõe conversas particulares, fotos de perfil de alunos e grupos confidenciais a qualquer pessoa que passe na sala da pedagogia.
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 mt-0.5">
                    <IconCheck className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Chat Isolado com Modo Privacidade</h4>
                    <p className="text-xs text-slate-500">
                      Abre unicamente o chat do responsável selecionado, mantendo toda a lista lateral de contatos e conversas pessoais blindada contra olhares de terceiros.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 mt-0.5">
                    <IconCheck className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Mensagens Padronizadas com Preenchimento Automático</h4>
                    <p className="text-xs text-slate-500">
                      Mensagens acolhedoras padronizadas que puxam o nome do estudante, turma e faltas sem digitação manual nem risco de vazamento de dados de outros alunos.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 mt-0.5">
                    <IconCheck className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Registro Automático no Prontuário</h4>
                    <p className="text-xs text-slate-500">
                      Cada disparo é auditado no banco com data, hora, servidora responsável e status de entrega, integrando-se automaticamente ao dossiê.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Simulador Interativo */}
            <div className="lg:col-span-7">
              <div className="bg-slate-50 rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-4 border-b border-slate-200/80 gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                      <h3 className="font-bold text-slate-900 text-sm">Simulador de Busca Ativa Humanizada</h3>
                    </div>
                    <p className="text-xs text-slate-500">Simulação de disparo oficial com proteção de dados (LGPD)</p>
                  </div>

                  {/* Toggle de Privacidade */}
                  <div className="flex items-center bg-white p-1 rounded-lg border border-slate-200 text-xs font-medium self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setPrivacyMode("compact")}
                      className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                        privacyMode === "compact"
                          ? "bg-emerald-600 text-white font-bold shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      <IconShield className="w-3 h-3" />
                      Janela Protegida (Rede Ativa)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrivacyMode("exposed")}
                      className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                        privacyMode === "exposed"
                          ? "bg-rose-600 text-white font-bold shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      <IconEye className="w-3 h-3" />
                      WhatsApp Web aberto
                    </button>
                  </div>
                </div>

                {/* Seleção do Estudante */}
                <div className="mb-4">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                    1. Selecione o Estudante em Risco de Infrequência:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {SAMPLE_STUDENTS.map((student) => {
                      const isSelected = selectedStudent.id === student.id;
                      return (
                        <button
                          key={student.id}
                          type="button"
                          onClick={() => {
                            setSelectedStudent(student);
                            setMessageSentSuccess(false);
                          }}
                          className={`p-3 rounded-xl border text-left transition-all ${
                            isSelected
                              ? "bg-white border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs"
                              : "bg-white/80 hover:bg-white border-slate-200 text-slate-700"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-slate-900 truncate">{student.name}</span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                student.risk === "critico"
                                  ? "bg-rose-100 text-rose-800"
                                  : student.risk === "medio"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-100 text-emerald-800"
                              }`}
                            >
                              {student.absences} faltas
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">{student.grade}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5 truncate">{student.parent}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Simulação da Janela de Despacho */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                  {privacyMode === "exposed" ? (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 mb-3 flex items-center gap-2">
                      <IconWarning className="w-4 h-4 shrink-0 text-rose-600" />
                      <span>
                        <strong>Risco no WhatsApp Web Aberto:</strong> Toda a lista de contatos pessoais e conversas alheias ficam à vista de quem estiver na sala.
                      </span>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <IconShield className="w-4 h-4 text-emerald-600" />
                        <span><strong>Modo Privacidade Ativo:</strong> Tela focada unicamente no responsável {selectedStudent.parent}.</span>
                      </div>
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-200 text-emerald-900">
                        100% LGPD
                      </span>
                    </div>
                  )}

                  {/* Seleção do Template */}
                  <div className="mb-3">
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Modelo da Mensagem Pedagógica:
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedTemplate("preventivo")}
                        className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                          selectedTemplate === "preventivo"
                            ? "bg-emerald-50 text-emerald-900 border-emerald-300 font-bold"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        Aviso Preventivo de Faltas
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedTemplate("critico_eca")}
                        className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                          selectedTemplate === "critico_eca"
                            ? "bg-rose-50 text-rose-900 border-rose-300 font-bold"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        Notificação ECA (Art. 56)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedTemplate("elogio")}
                        className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                          selectedTemplate === "elogio"
                            ? "bg-sky-50 text-sky-900 border-sky-300 font-bold"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        Elogio de Retorno / Assiduidade
                      </button>
                    </div>
                  </div>

                  {/* Prévia da Mensagem no Balão */}
                  <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 mb-3">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2">
                      <span>Destinatário: <strong>{selectedStudent.phone}</strong> ({selectedStudent.parent})</span>
                      <span>Canal Oficial da Escola</span>
                    </div>
                    <div className="bg-emerald-50 text-emerald-950 p-3 rounded-xl rounded-tl-none border border-emerald-200/80 text-xs leading-relaxed max-w-xl">
                      {getInterpolatedMessage()}
                    </div>
                  </div>

                  {/* Ação de Disparo */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                    <button
                      type="button"
                      disabled={isSendingMessage}
                      onClick={handleSimulateSend}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs shadow-xs flex items-center justify-center gap-2 transition-all"
                    >
                      {isSendingMessage ? (
                        <>
                          <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                          </svg>
                          <span>Registrando envio...</span>
                        </>
                      ) : (
                        <>
                          <IconSend className="w-3.5 h-3.5" />
                          <span>Disparar Mensagem de Busca Ativa</span>
                        </>
                      )}
                    </button>

                    {messageSentSuccess && (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 animate-fadeIn">
                        <IconCheck className="w-4 h-4 text-emerald-600" />
                        <span>Enviado e registrado no prontuário de {selectedStudent.name}!</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==============================================================================
          5. SEÇÃO 2: ZIGUEZAGUE - LIVRO OFICIAL DE ATAS PEDAGÓGICAS (LEI 14.063/2020)
          ============================================================================== */}
      <section id="livro-atas" className="py-16 md:py-24 border-b border-slate-100 bg-slate-50/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Simulador Interativo (lado esquerdo) */}
            <div className="lg:col-span-7 order-2 lg:order-1">
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-6">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200/80">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
                    <h3 className="font-bold text-slate-900 text-sm">Simulador de Lavratura Oficial de Ata</h3>
                  </div>
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                    ATA #2026/042
                  </span>
                </div>

                {/* Campo de Assunto */}
                <div className="mb-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Assunto da Reunião Pedagógica:
                  </label>
                  <input
                    type="text"
                    value={ataSubject}
                    onChange={(e) => setAtaSubject(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 bg-slate-50 font-medium text-slate-900"
                  />
                </div>

                {/* Redação com IA Assistida */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-700">
                      Teor da Deliberação Pedagógica:
                    </label>
                    <button
                      type="button"
                      onClick={handleSimulateAiWriting}
                      disabled={isAiTyping}
                      className="text-[11px] font-bold text-sky-700 hover:text-sky-800 flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-sky-50 border border-sky-200 transition-colors"
                    >
                      <IconSparkles className="w-3.5 h-3.5 text-sky-600" />
                      {isAiTyping ? "Redigindo com IA..." : "Redigir Ata com IA"}
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={ataText}
                    onChange={(e) => setAtaText(e.target.value)}
                    className="w-full p-3 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white font-serif leading-relaxed text-slate-800"
                    placeholder="Descreva o atendimento pedagógico..."
                  />
                </div>

                {/* Barra de Autenticação e Fé Pública */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {/* Passo 1: PIN da Servidora */}
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 mb-0.5">
                        <IconKey className="w-3.5 h-3.5 text-sky-600" />
                        1. PIN de Fé Pública (Servidora)
                      </div>
                      <p className="text-[11px] text-slate-500 leading-tight">
                        Validação por PIN pessoal intransferível da servidora.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setServerPinVerified(true)}
                      disabled={serverPinVerified}
                      className={`mt-2.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        serverPinVerified
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : "bg-white hover:bg-slate-100 text-slate-700 border border-slate-300"
                      }`}
                    >
                      {serverPinVerified ? (
                        <>
                          <IconCheck className="w-3.5 h-3.5 text-emerald-600" />
                          PIN Autenticado
                        </>
                      ) : (
                        "Autenticar PIN"
                      )}
                    </button>
                  </div>

                  {/* Passo 2: QR Code do Responsável */}
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 mb-0.5">
                        <IconQrCode className="w-3.5 h-3.5 text-teal-600" />
                        2. Assinatura do Pai no Celular
                      </div>
                      <p className="text-[11px] text-slate-500 leading-tight">
                        Pelo próprio celular, sem baixar aplicativo.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleStartQrSigning}
                      className="mt-2.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                    >
                      <IconSignature className="w-3.5 h-3.5 text-teal-600" />
                      {ataFinalized ? "Assinatura Coletada" : "Abrir QR Code de Assinatura"}
                    </button>
                  </div>
                </div>

                {/* Status da Ata */}
                <div className="p-3 rounded-xl bg-slate-100/80 border border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-3 h-3 rounded-full ${
                        ataFinalized ? "bg-emerald-500" : "bg-amber-400 animate-pulse"
                      }`}
                    ></span>
                    <span className="text-xs font-bold text-slate-800">
                      {ataFinalized ? "LAVRADA E ASSINADA (IMUTÁVEL)" : "STATUS: MINUTA EM ANDAMENTO"}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">
                    HASH: SHA-256: 7f8a...c32d
                  </span>
                </div>
              </div>
            </div>

            {/* Texto Descritivo (lado direito) */}
            <div className="lg:col-span-5 space-y-5 order-1 lg:order-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 text-sky-800 text-xs font-bold border border-sky-200/80">
                <IconScroll className="w-3.5 h-3.5" />
                Módulo 2: Fé Pública & Validade Jurídica
              </div>

              <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                Livro Oficial de Atas em Conformidade com a Lei 14.063/2020
              </h2>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                Adeus aos pesados cadernos de capa preta manuscritos e às folhas avulsas que se perdem nas gavetas. O Livro de Atas da Rede Ativa opera sob o regime de Fé Pública Administrativa com assinatura eletrônica avançada.
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-white border border-slate-200/80 shadow-xs">
                  <div className="w-6 h-6 rounded-md bg-sky-100 text-sky-800 flex items-center justify-center shrink-0 mt-0.5">
                    <IconScale className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Numeração Sequencial Inviolável e Anual</h4>
                    <p className="text-xs text-slate-500">
                      Impossível rasurar, intercalar ou sumir com atas antigas. O livro é gerado no final do ano em PDF/A encadernável.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-white border border-slate-200/80 shadow-xs">
                  <div className="w-6 h-6 rounded-md bg-sky-100 text-sky-800 flex items-center justify-center shrink-0 mt-0.5">
                    <IconSignature className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Assinatura do Responsável na Tela do Smartphone</h4>
                    <p className="text-xs text-slate-500">
                      O pai aponta a câmera para o QR Code da tela da escola e assina com o dedo no celular, sem fila nem impressora.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-white border border-slate-200/80 shadow-xs">
                  <div className="w-6 h-6 rounded-md bg-sky-100 text-sky-800 flex items-center justify-center shrink-0 mt-0.5">
                    <IconLock className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Termo Aditivo (&quot;Em tempo&quot;) Criptográfico</h4>
                    <p className="text-xs text-slate-500">
                      Após lavrada, a ata é imutável. Qualquer correção pós-assinatura exige Termo Aditivo vinculado com rastreabilidade jurídica.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==============================================================================
          6. SEÇÃO 3: ZIGUEZAGUE - DOSSIÊ ECA EM 1 CLIQUE
          ============================================================================== */}
      <section id="dossie-eca" className="py-16 md:py-24 border-b border-slate-100 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Texto Descritivo */}
            <div className="lg:col-span-5 space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 text-teal-800 text-xs font-bold border border-teal-200/80">
                <IconFolder className="w-3.5 h-3.5" />
                Módulo 3: Prontuário Integrado
              </div>

              <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                Dossiê Oficial em PDF em Menos de 30 Segundos
              </h2>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                Quando o Conselho Tutelar ou a Promotoria da Infância solicitam o histórico de um estudante em risco de infrequência crônica, a escola gasta até 3 dias úteis procurando fichas manuais, cadernos e comprovantes de WhatsApp.
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="w-6 h-6 rounded-md bg-teal-100 text-teal-800 flex items-center justify-center shrink-0 mt-0.5">
                    <IconCheck className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Compilação Histórica Automática</h4>
                    <p className="text-xs text-slate-500">
                      Faltas por período, tentativas de contato no WhatsApp com confirmação de entrega e atas pedagógicas assinadas em um só documento.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="w-6 h-6 rounded-md bg-teal-100 text-teal-800 flex items-center justify-center shrink-0 mt-0.5">
                    <IconCheck className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Certidão Cega Pública com QR Code</h4>
                    <p className="text-xs text-slate-500">
                      O conselheiro tutelar confere a autenticidade jurídica na hora pelo celular, sem expor dados de terceiros ou violar o Art. 143 do ECA.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="w-6 h-6 rounded-md bg-teal-100 text-teal-800 flex items-center justify-center shrink-0 mt-0.5">
                    <IconCheck className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Conformidade Arquivística (PDF/A-1b)</h4>
                    <p className="text-xs text-slate-500">
                      Gerado com preservação a longo prazo para o acervo permanente da secretaria e prestação de contas.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Micro-interface do Dossiê */}
            <div className="lg:col-span-7">
              <div className="bg-slate-50 rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-6">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200/80">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-teal-500"></span>
                    <h3 className="font-bold text-slate-900 text-sm">Gerador do Dossiê de Intervenção Pedagógica</h3>
                  </div>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-800">
                    Art. 56 ECA
                  </span>
                </div>

                {/* Card do Estudante em Pauta */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">Mariana Costa Ribeiro</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800">
                          11 Faltas (Crítico)
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Matrícula 2026-9A • 9º Ano A • Responsável: Carlos Ribeiro
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleGenerateDossier}
                      disabled={isGeneratingDossier}
                      className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold text-xs shadow-xs flex items-center justify-center gap-2 transition-all shrink-0"
                    >
                      {isGeneratingDossier ? (
                        <>
                          <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                          </svg>
                          <span>Compilando ({dossierProgress}%)...</span>
                        </>
                      ) : (
                        <>
                          <IconDocument className="w-3.5 h-3.5" />
                          <span>Gerar Dossiê em PDF</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Barra de Progresso quando gerando */}
                  {isGeneratingDossier && (
                    <div className="mt-3">
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-teal-600 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${dossierProgress}%` }}
                        ></div>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Consultando registro de presenças, histórico WhatsApp e atas pedagógicas no banco de dados...
                      </p>
                    </div>
                  )}
                </div>

                {/* Estrutura Prévia do Documento Formatado A4 */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 font-mono text-[11px] text-slate-700 shadow-xs space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-[10px] text-slate-500 font-sans">
                    <span className="font-bold text-slate-900 uppercase">Dossiê Pedagógico de Infrequência e Busca Ativa</span>
                    <span>CERTIDÃO #CT-2026/089</span>
                  </div>

                  <div className="space-y-1 font-sans text-xs">
                    <p><strong>1. Histórico de Notificações via WhatsApp:</strong> 3 disparos realizados (2 com confirmação de leitura).</p>
                    <p><strong>2. Atas Pedagógicas Vinculadas:</strong> ATA #012 (10/02) e ATA #034 (15/03) com assinatura do responsável.</p>
                    <p><strong>3. Justificativas Registradas:</strong> 2 ausências por consulta médica apresentadas.</p>
                  </div>

                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between font-sans text-[11px]">
                    <div className="flex items-center gap-1.5 text-emerald-700 font-bold">
                      <IconCheck className="w-3.5 h-3.5 text-emerald-600" />
                      Pronto para envio imediato ao Conselho Tutelar
                    </div>
                    <button
                      type="button"
                      onClick={() => setDossierModalOpen(true)}
                      className="text-teal-700 hover:text-teal-800 font-bold underline cursor-pointer"
                    >
                      Visualizar Prévia Completa do A4
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==============================================================================
          7. SEÇÃO 4: CALCULADORA DE IMPACTO COM COLUNAS ANIMADAS E RESPONSIVAS
          ============================================================================== */}
      <section id="calculadora" className="py-16 md:py-24 border-b border-slate-200/80 bg-slate-50/70">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-300/80 mb-3">
              <IconClock className="w-3.5 h-3.5 text-emerald-700" />
              Simulação de Carga Operacional ao Vivo
            </div>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Horas Semanais Gastas com Burocracia Mecânica
            </h2>
            <p className="mt-3 text-sm sm:text-base text-slate-600">
              Selecione o porte da sua instituição para calcular a economia semanal de tempo da equipe pedagógica.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Controles Interativos (Sliders) */}
            <div className="lg:col-span-5 bg-white p-6 sm:p-7 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col justify-between space-y-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label htmlFor={studentsInputId} className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <IconSchool className="w-3.5 h-3.5 text-emerald-600" />
                    Estudantes Matriculados
                  </label>
                  <span className="text-sm font-extrabold text-emerald-800 bg-emerald-50 px-3 py-0.5 rounded-lg border border-emerald-200">
                    {numStudents} estudantes
                  </span>
                </div>
                <input
                  id={studentsInputId}
                  type="range"
                  min={100}
                  max={2500}
                  step={50}
                  value={numStudents}
                  onChange={(e) => setNumStudents(Number(e.target.value))}
                  className="w-full accent-emerald-600 cursor-pointer h-2.5 bg-slate-100 rounded-lg transition-all"
                />
                <div className="flex justify-between text-[11px] text-slate-400 mt-1.5">
                  <span>100 alunos (Escola menor)</span>
                  <span>2.500 alunos (Grande polo)</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label htmlFor={staffInputId} className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <IconBuilding className="w-3.5 h-3.5 text-sky-600" />
                    Equipe Pedagógica / Apoio
                  </label>
                  <span className="text-sm font-extrabold text-sky-800 bg-sky-50 px-3 py-0.5 rounded-lg border border-sky-200">
                    {numStaff} profissionais
                  </span>
                </div>
                <input
                  id={staffInputId}
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={numStaff}
                  onChange={(e) => setNumStaff(Number(e.target.value))}
                  className="w-full accent-sky-600 cursor-pointer h-2.5 bg-slate-100 rounded-lg transition-all"
                />
                <div className="flex justify-between text-[11px] text-slate-400 mt-1.5">
                  <span>1 servidora</span>
                  <span>10 pedagogas/coordenadoras</span>
                </div>
              </div>
            </div>

            {/* Gráfico de Colunas Animadas em Tempo Real */}
            <div className="lg:col-span-7 bg-white p-6 sm:p-7 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col justify-between space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900">Comparativo Semanal de Carga Burocrática</h3>
                  <p className="text-[11px] text-slate-500">Horas totais da equipe dedicadas a rotinas mecânicas</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-black text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-300">
                    -{savingsPercent}% de Carga Mecânica
                  </span>
                </div>
              </div>

              {/* Área do Gráfico de Colunas Verticais */}
              <div className="relative pt-6 pb-2 px-2 sm:px-6">
                {/* Linhas de Grade de Fundo */}
                <div className="absolute inset-x-2 sm:inset-x-6 top-6 bottom-8 flex flex-col justify-between pointer-events-none opacity-40">
                  <div className="border-b border-dashed border-slate-200 w-full flex justify-end">
                    <span className="text-[10px] text-slate-400 -mt-2 pr-1">{maxScaleHours}h</span>
                  </div>
                  <div className="border-b border-dashed border-slate-200 w-full flex justify-end">
                    <span className="text-[10px] text-slate-400 -mt-2 pr-1">{Math.round(maxScaleHours * 0.66)}h</span>
                  </div>
                  <div className="border-b border-dashed border-slate-200 w-full flex justify-end">
                    <span className="text-[10px] text-slate-400 -mt-2 pr-1">{Math.round(maxScaleHours * 0.33)}h</span>
                  </div>
                  <div className="border-b border-slate-300 w-full flex justify-end">
                    <span className="text-[10px] text-slate-400 -mt-2 pr-1">0h</span>
                  </div>
                </div>

                {/* Colunas Comparativas */}
                <div className="h-64 sm:h-72 flex items-end justify-around gap-6 sm:gap-12 relative z-10 pt-6">
                  {/* Coluna 1: Rotina Manual Tradicional */}
                  <div className="w-1/2 flex flex-col items-center h-full justify-end group">
                    {/* Badge Superior Flutuante */}
                    <div className="mb-2 text-center transition-all duration-300">
                      <span className="text-base sm:text-lg font-black text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200 shadow-xs inline-block">
                        {manualWeeklyTotal}h
                      </span>
                      <span className="block text-[10px] font-bold text-rose-600 mt-0.5">semanais</span>
                    </div>

                    {/* Coluna Animada */}
                    <div className="w-full max-w-[120px] bg-slate-100 rounded-t-2xl p-1 h-full flex items-end">
                      <div
                        className="w-full bg-gradient-to-t from-rose-500 to-rose-400 rounded-t-xl shadow-md transition-all duration-500 ease-out flex items-center justify-center text-white font-bold text-xs"
                        style={{ height: `${manualColHeight}%` }}
                      >
                        <span className="hidden sm:inline opacity-80 text-[10px]">{manualColHeight}%</span>
                      </div>
                    </div>

                    <div className="mt-2 text-center">
                      <p className="text-xs font-bold text-slate-800">Rotina Manual Tradicional</p>
                      <p className="text-[10px] text-slate-400 hidden sm:block">Planilhas, ligações e cadernos</p>
                    </div>
                  </div>

                  {/* Coluna 2: Com a Rede Ativa */}
                  <div className="w-1/2 flex flex-col items-center h-full justify-end group">
                    {/* Badge Superior Flutuante */}
                    <div className="mb-2 text-center transition-all duration-300">
                      <span className="text-base sm:text-lg font-black text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-300 shadow-xs inline-block">
                        {platformWeeklyTotal}h
                      </span>
                      <span className="block text-[10px] font-bold text-emerald-700 mt-0.5">semanais</span>
                    </div>

                    {/* Coluna Animada */}
                    <div className="w-full max-w-[120px] bg-slate-100 rounded-t-2xl p-1 h-full flex items-end">
                      <div
                        className="w-full bg-gradient-to-t from-emerald-600 to-teal-500 rounded-t-xl shadow-md transition-all duration-500 ease-out flex items-center justify-center text-white font-bold text-xs"
                        style={{ height: `${platformColHeight}%` }}
                      >
                        <span className="hidden sm:inline opacity-90 text-[10px]">Ágil</span>
                      </div>
                    </div>

                    <div className="mt-2 text-center">
                      <p className="text-xs font-bold text-emerald-800">Com a Rede Ativa</p>
                      <p className="text-[10px] text-emerald-600 font-semibold hidden sm:block">Importação SERE & IA</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 4 Cards de Métricas Chave Atualizadas em Tempo Real */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 text-center transition-all">
                  <p className="text-xl font-extrabold text-emerald-700">{hoursSavedPerMonth}h</p>
                  <p className="text-[11px] text-slate-500 font-medium">Economizadas / mês</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 text-center transition-all">
                  <p className="text-xl font-extrabold text-sky-700">{paperSheetsSavedPerYear}</p>
                  <p className="text-[11px] text-slate-500 font-medium">Folhas papel / ano</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 text-center">
                  <p className="text-xl font-extrabold text-teal-700">&lt; 30s</p>
                  <p className="text-[11px] text-slate-500 font-medium">Dossiê Conselho</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 text-center">
                  <p className="text-xl font-extrabold text-indigo-700">+38%</p>
                  <p className="text-[11px] text-slate-500 font-medium">Retenção escolar</p>
                </div>
              </div>

              {/* CTA Dinâmico com Quantidade de Estudantes */}
              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                <p className="text-xs text-slate-500 text-center sm:text-left">
                  Estimativa baseada no porte de {numStudents} estudantes e {numStaff} profissionais.
                </p>
                <a
                  href={calculatorWhatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs flex items-center justify-center gap-2 transition-all shrink-0"
                >
                  <IconPhone className="w-3.5 h-3.5" />
                  <span>Agendar demonstração para instituição com {numStudents} estudantes</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==============================================================================
          8. SEÇÃO 6: CASE REAL DA ESCOLA PILOTO FUNDADORA
          ============================================================================== */}
      <section className="py-16 md:py-20 border-b border-slate-100 bg-slate-50/50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold mb-4">
            <IconSchool className="w-3.5 h-3.5" />
            Comprovado em Ambiente Real
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Nascido no Chão de Escola com 689 Estudantes
          </h2>

          <p className="mt-4 text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl mx-auto">
            A Rede Ativa não nasceu em um laboratório teórico. Ela foi concebida, validada e aprimorada diariamente dentro do Colégio Estadual Leopoldina B. Pedroso (INEP 41042730), resolvendo o gargalo de atendimento de centenas de famílias reais.
          </p>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-2xl font-extrabold text-emerald-700">689</span>
              <p className="text-xs font-bold text-slate-900 mt-1">Estudantes Acompanhados</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Gestão de faltas e comunicação com as famílias em tempo real.</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-2xl font-extrabold text-sky-700">0</span>
              <p className="text-xs font-bold text-slate-900 mt-1">Extravios de Documentos</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Atas pedagógicas arquivadas com Fé Pública e criptografia.</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-2xl font-extrabold text-teal-700">4 min</span>
              <p className="text-xs font-bold text-slate-900 mt-1">Tempo Médio por Atendimento</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Da redação assistida à assinatura do responsável via QR Code.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ==============================================================================
          10. SEÇÃO 7: FAQ PARA GESTORES ESCOLARES E SECRETARIAS
          ============================================================================== */}
      <section className="py-16 md:py-24 border-b border-slate-100 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Perguntas Frequentes de Diretores e Secretários
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Esclareça as principais dúvidas jurídicas e técnicas sobre a implantação na sua rede.
            </p>
          </div>

          <div className="space-y-4">
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <IconScale className="w-4 h-4 text-emerald-600 shrink-0" />
                As atas digitais têm a mesma validade jurídica do livro tradicional em papel?
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Sim, plenamente. A plataforma atende com rigor à <strong>Lei Federal nº 14.063/2020</strong> na modalidade de Assinatura Eletrônica Avançada, vinculando o PIN de fé pública do servidor, carimbo de tempo atômico, endereço IP e hash criptográfico SHA-256. Órgãos como Conselhos Tutelares e o Ministério Público aceitam o documento com total respaldo.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <IconBuilding className="w-4 h-4 text-sky-600 shrink-0" />
                É necessário instalar programas pesados ou trocar os computadores da escola?
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Não. A Rede Ativa roda 100% no navegador (Chrome, Edge, Firefox) e não exige instalação de nenhum software pesado nos computadores da escola, funcionando com excelente desempenho mesmo em máquinas mais antigas.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <IconDocument className="w-4 h-4 text-teal-600 shrink-0" />
                Como importamos as turmas e alunos dos sistemas estaduais ou municipais (ex: SERE)?
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                A plataforma conta com importador inteligente via arquivo CSV/Excel compatível com os relatórios padrão de matrículas dos sistemas de gestão escolar estadual e municipal. Em menos de 2 minutos, toda a escola é provisionada.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <IconLock className="w-4 h-4 text-indigo-600 shrink-0" />
                Como a escola fica resguardada quanto à Lei Geral de Proteção de Dados (LGPD)?
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                O portal de validação externa por QR Code exibe apenas uma <strong>Certidão Cega</strong>, mascarando nomes e documentos de menores para cumprir os Artigos 17 e 143 do ECA e a LGPD. As consultas com inteligência artificial utilizam camada de anonimização prévia.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ==============================================================================
          11. SEÇÃO 8: CTA FINAL & RODAPÉ INSTITUCIONAL
          ============================================================================== */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-slate-50 to-white text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center p-2.5 mx-auto mb-5">
            <img src="/logo-symbol.svg" alt="Rede Ativa" className="w-full h-full object-contain" />
          </div>

          <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Pronto para Levar Segurança e Modernidade à Sua Rede?
          </h2>
          <p className="mt-4 text-sm sm:text-base text-slate-600 max-w-xl mx-auto">
            Agende uma apresentação executiva de 15 minutos e veja como implantar a Rede Ativa na sua instituição ou município.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href={generalWhatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md shadow-emerald-600/20 flex items-center gap-2 transition-all transform hover:-translate-y-0.5"
            >
              <IconPhone className="w-4 h-4" />
              Falar com Consultor Pedagógico no WhatsApp
            </a>
            <Link
              href="/login"
              className="px-6 py-3.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm border border-slate-200 shadow-xs flex items-center gap-2 transition-all"
            >
              Acessar sistema
              <IconChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Rodapé Institucional com Logo Destacado */}
      <footer className="border-t border-slate-200 bg-white py-10 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="Rede Ativa" className="h-8 w-auto object-contain" />
            <span className="text-slate-300">|</span>
            <span className="font-semibold text-slate-600">Gestão Pedagógica • Paraná</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-5">
            <a href="#busca-ativa" className="hover:text-slate-900 transition-colors">Busca Ativa</a>
            <a href="#livro-atas" className="hover:text-slate-900 transition-colors">Livro de Atas</a>
            <a href="#dossie-eca" className="hover:text-slate-900 transition-colors">Dossiê ECA</a>
            <a href="#calculadora" className="hover:text-slate-900 transition-colors">Calculadora de Horas</a>
            <Link href="/login" className="font-bold text-emerald-700 hover:underline">
              Acessar sistema
            </Link>
          </div>
        </div>
      </footer>

      {/* ==============================================================================
          MODAIS INTERATIVOS DE DEMONSTRAÇÃO
          ============================================================================== */}

      {/* Modal 1: Simulação do QR Code de Assinatura */}
      {qrModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center shadow-xl border border-slate-200 animate-fadeIn">
            <div className="flex justify-between items-center mb-4">
              <span className="text-xs font-bold text-slate-900 uppercase">Assinatura do Responsável</span>
              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none p-1"
              >
                &times;
              </button>
            </div>

            <div className="w-48 h-48 mx-auto bg-slate-50 rounded-xl border border-slate-200 p-3 flex flex-col items-center justify-center mb-4 shadow-inner">
              {qrSignedStep === "waiting" && (
                <>
                  <IconQrCode className="w-24 h-24 text-slate-800" />
                  <p className="text-[11px] text-slate-500 mt-2">Aponte o celular do responsável...</p>
                </>
              )}
              {qrSignedStep === "scanning" && (
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center mb-2 animate-bounce">
                    <IconSignature className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-slate-900">Coletando Assinatura...</p>
                  <p className="text-[10px] text-slate-500">Responsável assinando no celular</p>
                </div>
              )}
              {qrSignedStep === "signed" && (
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2">
                    <IconCheck className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-emerald-900">Assinatura Concluída!</p>
                  <p className="text-[10px] text-emerald-700">Auditado sob a Lei 14.063/2020</p>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-600 mb-4">
              {qrSignedStep === "signed"
                ? "A ata foi lavrada com sucesso no livro oficial e os hashes criptográficos foram gravados."
                : "Simulação interativa: o responsável assina na tela do smartphone com o dedo, sem necessidade de senha prévia."}
            </p>

            <button
              type="button"
              onClick={() => setQrModalOpen(false)}
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors"
            >
              Fechar Demonstração
            </button>
          </div>
        </div>
      )}

      {/* Modal 2: Prévia Completa do Dossiê A4 */}
      {dossierModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 text-slate-900 shadow-2xl border border-slate-200 animate-fadeIn max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span className="text-xs font-bold uppercase text-slate-900">Dossiê Oficial Gerado em PDF/A</span>
              </div>
              <button
                type="button"
                onClick={() => setDossierModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none p-1"
              >
                &times;
              </button>
            </div>

            {/* Simulação de Folha A4 */}
            <div className="bg-white border border-slate-300 rounded-lg p-6 font-serif shadow-xs space-y-4 text-xs leading-relaxed">
              <div className="text-center border-b border-slate-200 pb-3">
                <p className="font-sans font-extrabold text-sm text-slate-900 tracking-tight">REDE ATIVA • COORDENAÇÃO PEDAGÓGICA</p>
                <p className="font-sans text-[11px] text-slate-500">RELATÓRIO CIRCUNSTANCIADO DE INFREQUÊNCIA ESCOLAR (ART. 56 ECA)</p>
                <p className="font-mono text-[10px] text-slate-400 mt-1">CERTIDÃO DIGITAL Nº 2026/089-ECA</p>
              </div>

              <div>
                <p className="font-sans font-bold text-slate-900 mb-1">1. IDENTIFICAÇÃO DO(A) ESTUDANTE</p>
                <div className="grid grid-cols-2 gap-2 font-sans text-[11px] bg-slate-50 p-2.5 rounded-md border border-slate-200">
                  <p><strong>Nome:</strong> Mariana Costa Ribeiro</p>
                  <p><strong>Matrícula:</strong> 2026-9A</p>
                  <p><strong>Turma:</strong> 9º Ano A (Ensino Fundamental)</p>
                  <p><strong>Responsável Legal:</strong> Carlos Ribeiro (Pai)</p>
                  <p><strong>Total de Faltas Não Justificadas:</strong> 11 dias letivos</p>
                  <p><strong>Percentual de Infrequência:</strong> 22% no bimestre</p>
                </div>
              </div>

              <div>
                <p className="font-sans font-bold text-slate-900 mb-1">2. HISTÓRICO DE AÇÕES DE BUSCA ATIVA (WHATSAPP AUDITADO)</p>
                <div className="font-sans text-[11px] space-y-1.5 bg-slate-50 p-2.5 rounded-md border border-slate-200">
                  <p>• <strong>15/02/2026 às 09:14:</strong> Notificação preventiva expedida via WhatsApp institucional ao responsável Carlos Ribeiro. (Status: Entregue)</p>
                  <p>• <strong>28/02/2026 às 14:32:</strong> Notificação formal de aproximação ao teto do Art. 56 do ECA expedida. (Status: Lido)</p>
                </div>
              </div>

              <div>
                <p className="font-sans font-bold text-slate-900 mb-1">3. REGISTRO NO LIVRO OFICIAL DE ATAS (LEI 14.063/2020)</p>
                <div className="font-sans text-[11px] space-y-1 bg-slate-50 p-2.5 rounded-md border border-slate-200">
                  <p>• <strong>ATA #2026/042 (05/03/2026):</strong> Reunião presencial realizada com o responsável legal. Firmado plano de recuperação de frequência.</p>
                  <p>• <strong>Assinaturas:</strong> Servidora Pedagoga (PIN PBKDF2) e Responsável Legal (Assinatura Eletrônica em Dispositivo Móvel).</p>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3 flex items-center justify-between font-sans text-[10px] text-slate-500">
                <div>
                  <p className="font-bold text-slate-800">Autenticidade Verificável via QR Code</p>
                  <p>Padrão Arquivístico ISO 19005-1 (PDF/A-1b)</p>
                </div>
                <div className="w-12 h-12 bg-slate-100 rounded border border-slate-200 flex items-center justify-center">
                  <IconQrCode className="w-8 h-8 text-slate-700" />
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDossierModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
              >
                Fechar Prévia
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-colors flex items-center gap-1.5"
              >
                <IconDocument className="w-3.5 h-3.5" />
                Imprimir Documento Oficial
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
