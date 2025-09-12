import { Alert } from "@heroui/react";

export default function ErrorCard({
  error,
  message,
}: {
  error: string;
  message: string;
}) {
  return <Alert color="danger" description={message} title={error} />;
}
