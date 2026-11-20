import { AuthFrame } from "@/features/auth/auth-shell"
import { SignInForm } from "@/features/auth/sign-in-form"

export const metadata = { title: "Sign in" }

export default function Page() {
  return (
    <AuthFrame variant={2}>
      <SignInForm />
    </AuthFrame>
  )
}
