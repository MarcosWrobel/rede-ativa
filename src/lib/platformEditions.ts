/**
 * platformEditions.ts
 *
 * Governança das Duas Versões da Plataforma Rede Ativa SaaS no Paraná:
 * 1. PILOTO_INTEGRADA: Edição Completa SEED-PR (Power BI, SERP, Extensão com 3 scripts).
 * 2. INSTITUCIONAL_ESSENCIAL: Edição Juridicamente Segura (sem scrapers governamentais,
 *    foco em Busca Ativa WhatsApp, Livro de Atas Lei 14.063/2020 e Faltas via CSV/SERE).
 *
 * Regras Inegociáveis:
 * - A Escola Piloto Fundadora (INEP 41042730 ou id "default-leopoldina") é SEMPRE PILOTO_INTEGRADA.
 * - Novas escolas em redes municipais herdam a edição definida pelo Superadmin na SEMEC.
 */

export type PlatformEdition = "PILOTO_INTEGRADA" | "INSTITUCIONAL_ESSENCIAL";

export const PILOT_SCHOOL_INEP = "41042730";
export const PILOT_SCHOOL_ID = "default-leopoldina";

export interface SchoolEditionTarget {
  id?: string | null;
  inepCode?: string | null;
  settingsJson?: string | null;
  networkId?: string | null;
}

/**
 * Verifica se uma edição específica corresponde à Piloto Integrada
 */
export function isPilotIntegrated(edition?: string | null): boolean {
  return edition === "PILOTO_INTEGRADA";
}

/**
 * Resolve a versão efetiva da instituição escolar aplicando a hierarquia:
 * 1. Escola Piloto Leopoldina -> SEMPRE PILOTO_INTEGRADA (inviolável)
 * 2. settingsJson da Escola -> se explicitamente definido
 * 3. settingsJson da Rede / SEMEC -> herança hierárquica
 * 4. Fallback padrão seguro -> INSTITUCIONAL_ESSENCIAL
 */
export function resolveSchoolEdition(
  school?: SchoolEditionTarget | null,
  networkSettingsJson?: string | null
): PlatformEdition {
  if (!school) {
    return "INSTITUCIONAL_ESSENCIAL";
  }

  // Regra Inviolável 1: Escola Piloto Fundadora é sempre PILOTO_INTEGRADA
  const inep = (school.inepCode || "").trim();
  const id = (school.id || "").trim();
  if (inep === PILOT_SCHOOL_INEP || id === PILOT_SCHOOL_ID) {
    return "PILOTO_INTEGRADA";
  }

  // 2. Configuração explícita em settingsJson da própria escola
  if (school.settingsJson) {
    try {
      const parsed = typeof school.settingsJson === "string" ? JSON.parse(school.settingsJson) : school.settingsJson;
      if (parsed?.edition === "PILOTO_INTEGRADA" || parsed?.edition === "INSTITUCIONAL_ESSENCIAL") {
        return parsed.edition;
      }
      // Retrocompatibilidade: se tinha flag explícita antiga
      if (parsed?.enablePowerBiSync === true || parsed?.features?.powerBiSync === true) {
        return "PILOTO_INTEGRADA";
      }
    } catch {
      // JSON inválido: segue para herança
    }
  }

  // 3. Herança da SEMEC / EducationNetwork vinculada
  if (networkSettingsJson) {
    try {
      const parsedNet = typeof networkSettingsJson === "string" ? JSON.parse(networkSettingsJson) : networkSettingsJson;
      if (parsedNet?.edition === "PILOTO_INTEGRADA" || parsedNet?.edition === "INSTITUCIONAL_ESSENCIAL") {
        return parsedNet.edition;
      }
    } catch {
      // JSON inválido: segue para fallback
    }
  }

  // 4. Padrão seguro para o SaaS: Institucional Essencial (sem riscos de raspagem)
  return "INSTITUCIONAL_ESSENCIAL";
}

/**
 * Determina se a instituição possui permissão para utilizar sincronizadores externos
 * de Power BI e SERP.
 */
export function canUseGovernmentScrapers(
  school?: SchoolEditionTarget | null,
  networkSettingsJson?: string | null
): boolean {
  return resolveSchoolEdition(school, networkSettingsJson) === "PILOTO_INTEGRADA";
}
