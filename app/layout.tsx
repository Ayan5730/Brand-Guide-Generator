import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Brand Guide Generator",
  description: "Turn any live company website into a reusable brand guide."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
