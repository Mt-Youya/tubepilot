// Server Component — exports generateStaticParams for static export.
// All state/logic lives in the Client Component below.
import EditorPageClient from "./editor-page";

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function EditorPage() {
  return <EditorPageClient />;
}
