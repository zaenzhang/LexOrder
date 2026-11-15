import "@testing-library/jest-dom/vitest";
import { randomBytes } from "node:crypto";

// 独立运行单测不读取部署 .env；使用本次测试进程的临时密钥。
process.env.STORAGE_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
