import PublishPageClient from "./publish-page";

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function PublishPage() {
  return <PublishPageClient />;
}
