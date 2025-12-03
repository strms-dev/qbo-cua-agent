import { Suspense } from "react";
import STRMSAgent from "@/components/STRMSAgent";

export default function Home() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center">Loading...</div>}>
      <STRMSAgent />
    </Suspense>
  );
}
