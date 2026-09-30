import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders GitHub-flavoured markdown written by people or agents. Raw HTML is
 * skipped and unsafe URLs (such as `javascript:`) are removed by react-markdown's
 * default URL transform; links open in a new tab.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `prose-md ${className}` : "prose-md"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          // react-markdown passes the hast `node`, which must not reach the DOM.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
