import type { DefaultSession } from "next-auth";
import type { RoleLevel } from "@/lib/roles";

export interface SessionSchoolLink {
  id?: string;
  schoolId: string;
  role: string;
  name?: string;
  inepCode?: string;
  city?: string;
  network?: string;
  logoUrl?: string | null;
  active?: boolean;
}

export interface SessionNetworkLink {
  id?: string;
  networkId: string;
  role: string;
  name?: string;
  shortName?: string;
  city?: string;
  type?: string;
  logoUrl?: string | null;
  network?: {
    city?: string;
  };
}

declare module "next-auth" {
  interface User {
    dbId?: string;
    role?: RoleLevel | "ADMIN" | string;
    active?: boolean;
    schoolId?: string | null;
    networkId?: string | null;
    inepCode?: string | null;
    schools?: SessionSchoolLink[];
    networks?: SessionNetworkLink[];
  }

  interface Session {
    activeSchoolId?: string;
    user: {
      id?: string;
      dbId?: string;
      role?: RoleLevel | "ADMIN" | string;
      active?: boolean;
      schoolId?: string | null;
      networkId?: string | null;
      inepCode?: string | null;
      schools?: SessionSchoolLink[];
      networks?: SessionNetworkLink[];
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId?: string;
    role?: RoleLevel | "ADMIN" | string;
    active?: boolean;
    schoolId?: string | null;
    checkedAt?: number;
    image?: string;
    userSchools?: SessionSchoolLink[];
    userNetworks?: SessionNetworkLink[];
  }
}
