import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  limitOptions?: number[];
  itemLabel?: string;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  onLimitChange,
  limitOptions = [5, 10, 20, 50],
  itemLabel = 'registros',
  className = '',
}) => {
  if (totalItems === 0) return null;

  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  // Geração de páginas inteligentes com elipses
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4, '...', totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
      }
    }
    return pages;
  };

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-2 border-t border-slate-800 text-xs text-slate-400 ${className}`}
    >
      {/* Contagem de Itens e Seletor por Página */}
      <div className="flex items-center gap-3">
        <span>
          Mostrando <strong className="text-white font-mono">{startItem}</strong> a{' '}
          <strong className="text-white font-mono">{endItem}</strong> de{' '}
          <strong className="text-emerald-400 font-mono">{totalItems}</strong> {itemLabel}
        </span>

        {onLimitChange && (
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-slate-500">Por pág:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                onLimitChange(Number(e.target.value));
                onPageChange(1);
              }}
              className="bg-[#0b1329] border border-slate-700 hover:border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition cursor-pointer"
            >
              {limitOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Controles de Navegação */}
      <div className="flex items-center gap-1">
        {/* Primeira Página */}
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="p-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-[#0b1329] text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
          title="Primeira página"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>

        {/* Página Anterior */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="p-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-[#0b1329] text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
          title="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Números das Páginas */}
        <div className="flex items-center gap-1 mx-1">
          {getPageNumbers().map((page, index) => {
            if (page === '...') {
              return (
                <span key={`ellipsis-${index}`} className="px-2 text-slate-600 select-none">
                  ...
                </span>
              );
            }

            const pageNum = Number(page);
            const isActive = pageNum === currentPage;

            return (
              <button
                key={`page-${pageNum}`}
                onClick={() => onPageChange(pageNum)}
                className={`min-w-[30px] h-[30px] px-2 rounded-lg font-mono text-xs font-semibold transition ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-950/40 border border-emerald-500'
                    : 'bg-[#0b1329] border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
        </div>

        {/* Próxima Página */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages || totalPages === 0}
          className="p-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-[#0b1329] text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
          title="Próxima página"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {/* Última Página */}
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages || totalPages === 0}
          className="p-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-[#0b1329] text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
          title="Última página"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
