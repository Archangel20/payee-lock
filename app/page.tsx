import { Suspense } from "react";
import { HowItWorks } from "@/components/HowItWorks";
import { PayeeList } from "@/components/PayeeList";
import { VerifyApp } from "@/components/VerifyApp";

export default function HomePage() {
  return (
    <>
      <Suspense fallback={<p className="muted">Loading the verifier…</p>}>
        <VerifyApp />
      </Suspense>
      <HowItWorks />
      <PayeeList />
    </>
  );
}
