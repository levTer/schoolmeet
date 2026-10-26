import { AiBoardSection } from "@/components/landing/ai-board-section";
import { CtaSection } from "@/components/landing/cta-section";
import { Features } from "@/components/landing/features";
import { Hero } from "@/components/landing/hero";
import { ScheduleSection } from "@/components/landing/schedule-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

export default function HomePage() {
  return (
    <main className="relative min-h-[100dvh] overflow-x-hidden">
      <SiteHeader />

      <Hero />
      <Features />
      <AiBoardSection />
      <ScheduleSection />
      <CtaSection />

      <SiteFooter />
    </main>
  );
}
