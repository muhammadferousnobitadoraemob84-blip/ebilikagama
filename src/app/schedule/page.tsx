"use client";

import { useLanguage } from "@/components/LanguageProvider";
import ProgramSchedule from "@/components/ProgramSchedule";

export default function SchedulePage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-black">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-10">
        {/* Page title */}
        <div className="flex items-center gap-2.5 sm:gap-3 mb-5 sm:mb-8">
          <div className="w-1 h-6 sm:h-8 bg-red-600 rounded-full" />
          <h1 className="text-white text-lg sm:text-2xl md:text-3xl font-bold tracking-tight">
            {t("schedule_title")}
          </h1>
        </div>

        {/* EPG Timeline */}
        <ProgramSchedule />
      </div>
    </div>
  );
}
