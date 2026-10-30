import { notFound } from "next/navigation";

// All supported sections have dedicated routes; unknown paths must return 404.
export default function UnknownSection() {
  notFound();
}
