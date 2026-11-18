import { Metadata } from "next";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { PRODUCT_NAME } from "@/lib/product";
import { LoginForm } from "./login-form";
import { LoginProtectionDialog } from "./login-protection-dialog";
import { isPersonalMode } from "@/lib/runtime/mode";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: `登录 — ${PRODUCT_NAME}`
};

export default function LoginPage() {
  if (isPersonalMode()) redirect("/");

  return (
    <div className="mo-login">
      <div className="login">
        <div className="brand-panel">
          <p className="bp-title">
            让每一件案件，
            <br />
            都<span className="hl">有迹可循</span>。
          </p>
        </div>

        <div className="form-panel">
          <div className="fp-body">
            <div className="fp-heading">
              <h1 className="fp-title">登录律序</h1>
              <LoginProtectionDialog />
            </div>
            <Suspense fallback={<LoginFallback />}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="flex h-56 items-center justify-center text-[var(--t-muted)]">
      <Loader2 className="h-4 w-4 animate-spin" />
    </div>
  );
}
