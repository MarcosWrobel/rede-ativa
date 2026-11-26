"use client";

import { useEffect, useRef } from "react";
import { cleanupLegacyServiceWorkersAndCaches } from "@/lib/pwaCleanup";

export default function PwaRegister() {
  const cleanedRef = useRef(false);

  useEffect(() => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;
    void cleanupLegacyServiceWorkersAndCaches();
  }, []);

  return null;
}
