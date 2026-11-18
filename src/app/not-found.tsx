import Link from "next/link";
import { PRODUCT_SHORT_NAME } from "@/lib/product";

/** 全站兜底 404 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--semi-color-fill-0)] px-4">
      <div className="card max-w-md px-8 py-10 text-center">
        <div className="font-mono text-[13px] text-[var(--semi-color-text-3)]">404</div>
        <h1 className="mt-2 text-[20px] font-bold text-[var(--semi-color-text-0)]">页面不存在</h1>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--semi-color-text-2)]">链接可能有误或页面已调整。</p>
        <div className="mt-5 flex justify-center">
          <Link href="/" className="btn btn-primary btn-sm">返回{PRODUCT_SHORT_NAME}</Link>
        </div>
      </div>
    </div>
  );
}
