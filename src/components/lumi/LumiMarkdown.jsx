import React from 'react';
import ReactMarkdown from 'react-markdown';

// Lumi answers in Markdown (bulleted attendance summaries, bold totals). The
// chat used to wrap it in `prose`, but @tailwindcss/typography is not
// installed, so the classes did nothing and Tailwind's preflight stripped the
// bullets and heading sizes: lists read as run-together lines on a phone.
// An explicit components map on the app's own theme tokens styles exactly
// what Lumi emits, follows light/dark with no `prose-invert`, and adds no
// dependency.
const components = {
  p: ({ node: _node, ...props }) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="mb-2 last:mb-0 list-disc space-y-1 pl-5" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="mb-2 last:mb-0 list-decimal space-y-1 pl-5" {...props} />,
  li: ({ node: _node, ...props }) => <li className="leading-relaxed marker:text-muted-foreground" {...props} />,
  h1: ({ node: _node, ...props }) => <p className="mb-1 mt-2 first:mt-0 font-semibold text-base" {...props} />,
  h2: ({ node: _node, ...props }) => <p className="mb-1 mt-2 first:mt-0 font-semibold" {...props} />,
  h3: ({ node: _node, ...props }) => <p className="mb-1 mt-2 first:mt-0 font-semibold" {...props} />,
  h4: ({ node: _node, ...props }) => <p className="mb-1 mt-2 first:mt-0 font-medium" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold text-foreground" {...props} />,
  em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
  a: ({ node: _node, ...props }) => (
    <a className="break-words font-medium text-brand underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground" {...props} />
  ),
  code: ({ node: _node, ...props }) => (
    <code className="rounded bg-background/70 px-1 py-0.5 font-mono text-[0.85em]" {...props} />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-background/70 p-2 text-xs" {...props} />
  ),
  hr: ({ node: _node, ...props }) => <hr className="my-2 border-border" {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => <th className="border-b border-border px-2 py-1 font-semibold" {...props} />,
  td: ({ node: _node, ...props }) => <td className="border-b border-border/60 px-2 py-1 align-top" {...props} />,
};

export default function LumiMarkdown({ children }) {
  return (
    <div className="text-sm text-foreground break-words">
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  );
}
