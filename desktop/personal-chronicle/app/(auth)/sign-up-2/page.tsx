import { AuthFrame } from "@/features/auth/auth-shell"
import { SignUpForm } from "@/features/auth/sign-up-form"

export const metadata = { title: "Create an account" }

export default function Page() {
  return (
    <AuthFrame variant={2}>
      <SignUpForm />
    </AuthFrame>
  )
}
