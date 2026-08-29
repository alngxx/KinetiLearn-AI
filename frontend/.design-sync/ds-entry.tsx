// Explicit barrel for design-sync: the design-system surface only.
// Avoids the converter's synth entry, which would pull in main.tsx and run
// the app's bootstrap inside every preview.

export * from "@/components/ui/alert-dialog";
export * from "@/components/ui/badge";
export * from "@/components/ui/button";
export * from "@/components/ui/card";
export * from "@/components/ui/dialog";
export * from "@/components/ui/dropdown-menu";
export * from "@/components/ui/input";
export * from "@/components/ui/label";
export * from "@/components/ui/sonner";
// Same sonner instance the bundled Toaster subscribes to — a preview importing
// "sonner" directly would bundle a second copy with its own toast store.
export { toast } from "sonner";
export * from "@/components/ui/table";
export * from "@/components/ui/textarea";

export * from "@/components/AnswerLine";
export * from "@/components/ConfirmDialog";
export * from "@/components/EmptyState";
export * from "@/components/PageHeader";
export * from "@/components/QueryErrorState";
export * from "@/components/ResultBadge";
export * from "@/components/RowActions";
export * from "@/components/StatusBadge";
export * from "@/components/ThemeToggle";

export * from "@/components/form/FieldRow";


// Preview-only context wrapper (cfg.provider). Router for components that
// render <Link>, theme context for ThemeToggle. Not part of the app's own
// component surface — componentSrcMap decides which names get cards.
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@/modules/theme/ThemeContext";

export { ThemeProvider };

export function DesignPreviewProvider({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <ThemeProvider>{children}</ThemeProvider>
    </MemoryRouter>
  );
}
