import { Suspense } from "react"

import { UsersPage } from "@/features/users/users-page"

export const metadata = { title: "Users" }

export default function Page() {
  return (
    <Suspense>
      <UsersPage />
    </Suspense>
  )
}
