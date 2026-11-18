import { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/product";
import { LoginPanel } from "./login-form";
import styles from "./login.module.css";
import { isPersonalMode } from "@/lib/runtime/mode";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: `登录 — ${PRODUCT_NAME}`
};

export default function LoginPage() {
  if (isPersonalMode()) redirect("/");

  return (
    <main className={styles.page}>
      <div className={styles.brandPanel}>
        <p className={styles.brandTitle}>
          让每一件案件，
          <br />
          都<span>有迹可循</span>。
        </p>
      </div>

      <section className={styles.formPanel} aria-label="登录">
        <LoginPanel />
      </section>
    </main>
  );
}
