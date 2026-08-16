import React from 'react';

// OmniTestAI Forge's own mark — an anvil struck by a spark, standing in for
// "forging" test cases. Deliberately not the ShieldCheck icon the original
// OmniTestAI uses, so the two tools don't look like the same product.
interface ForgeLogoProps {
  size?: number;
  className?: string;
}

export const ForgeLogo: React.FC<ForgeLogoProps> = ({ size = 22, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    {/* Anvil body */}
    <path
      d="M4 15.5h6.2l1.1 2H16l1.1-2H20a1 1 0 0 0 0-2h-2.2l-1.4-4.6A2 2 0 0 0 14.5 7.5H12V6h1a1 1 0 0 0 0-2h-4a1 1 0 0 0 0 2h1v1.5H8.2a2 2 0 0 0-1.9 1.4L4.9 13.5H4a1 1 0 0 0 0 2Z"
      fill="currentColor"
    />
    {/* Base */}
    <rect x="9.5" y="19" width="5" height="2" rx="0.6" fill="currentColor" opacity="0.85" />
    {/* Spark */}
    <path
      d="M18.5 3.2c.35 1 .75 1.4 1.75 1.75-1 .35-1.4.75-1.75 1.75-.35-1-.75-1.4-1.75-1.75 1-.35 1.4-.75 1.75-1.75Z"
      fill="currentColor"
    />
  </svg>
);
