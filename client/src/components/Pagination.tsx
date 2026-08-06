import { Button } from '@/components/ui/button';

/** Pages shown on either side of the current one. */
const RADIUS = 1;

/**
 * Page numbers to render, with `null` standing in for a gap.
 *
 * Rendering every page wraps onto several lines on a phone — twenty
 * notifications pages is twenty buttons in a row. A window around the current
 * page plus the two ends stays on one line at any count.
 */
function pageItems(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set([1, total]);
  for (let n = current - RADIUS; n <= current + RADIUS; n++) {
    if (n > 1 && n < total) pages.add(n);
  }

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const items: (number | null)[] = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) items.push(null);
    items.push(page);
  });
  return items;
}

export default function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    // Numerals read left-to-right even inside the RTL page.
    <nav className="flex items-center justify-center gap-1" dir="ltr" aria-label="التنقل بين الصفحات">
      <Button
        variant="outline"
        size="sm"
        className="rounded-lg h-9 px-2.5"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        aria-label="الصفحة السابقة"
      >
        ‹
      </Button>

      {pageItems(page, pageCount).map((item, index) =>
        item === null ? (
          <span key={`gap-${index}`} className="px-1 text-gray-400 select-none">
            …
          </span>
        ) : (
          <button
            key={item}
            onClick={() => onChange(item)}
            aria-label={`الصفحة ${item}`}
            aria-current={item === page ? 'page' : undefined}
            className={`h-9 min-w-9 px-2 rounded-lg text-sm font-medium transition-colors ${
              item === page
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {item}
          </button>
        ),
      )}

      <Button
        variant="outline"
        size="sm"
        className="rounded-lg h-9 px-2.5"
        disabled={page === pageCount}
        onClick={() => onChange(page + 1)}
        aria-label="الصفحة التالية"
      >
        ›
      </Button>
    </nav>
  );
}
