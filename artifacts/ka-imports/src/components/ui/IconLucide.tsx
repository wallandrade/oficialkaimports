import * as Icons from "lucide-react";
import React from "react";

const validIcons = new Set(Object.keys(Icons));

export function IconLucide({ name, ...props }: { name?: string; [key: string]: any }) {
  let iconName = typeof name === "string" && name ? name : "HelpCircle";
  if (!validIcons.has(iconName)) iconName = "HelpCircle";
  const LucideIcon = Icons[iconName as keyof typeof Icons];
  return <LucideIcon {...props} />;
}
