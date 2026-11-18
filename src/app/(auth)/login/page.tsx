import { Metadata } from "next";
import { Suspense } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { PRODUCT_NAME } from "@/lib/product";
import { LoginForm } from "./login-form";
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
              <Dialog>
                <DialogTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label="登录保护说明" title="登录保护说明">
                    <ShieldCheck aria-hidden data-icon="inline-start" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>登录保护</DialogTitle>
                    <DialogDescription>
                      连续 5 次登录失败后，账号将锁定 15 分钟。管理员可要求两步验证。
                    </DialogDescription>
                  </DialogHeader>
                </DialogContent>
              </Dialog>
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
