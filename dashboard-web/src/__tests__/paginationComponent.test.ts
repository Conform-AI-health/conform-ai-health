import { describe, it, expect } from 'vitest';

describe('Frontend - Lógica e Regras de Paginação de Tabelas', () => {
  it('deve calcular corretamente o range de itens exibidos na página', () => {
    const calculateRange = (currentPage: number, itemsPerPage: number, totalItems: number) => {
      const startItem = (currentPage - 1) * itemsPerPage + 1;
      const endItem = Math.min(currentPage * itemsPerPage, totalItems);
      return { startItem, endItem };
    };

    const page1 = calculateRange(1, 10, 25);
    expect(page1.startItem).toBe(1);
    expect(page1.endItem).toBe(10);

    const page3 = calculateRange(3, 10, 25);
    expect(page3.startItem).toBe(21);
    expect(page3.endItem).toBe(25);
  });

  it('deve calcular o número total de páginas corretamente', () => {
    const calculateTotalPages = (totalItems: number, itemsPerPage: number) => {
      return Math.ceil(totalItems / itemsPerPage) || 1;
    };

    expect(calculateTotalPages(0, 10)).toBe(1);
    expect(calculateTotalPages(9, 10)).toBe(1);
    expect(calculateTotalPages(11, 10)).toBe(2);
    expect(calculateTotalPages(50, 10)).toBe(5);
  });

  it('deve gerar elipses adequadas para navegação com muitas páginas', () => {
    const getPageNumbers = (currentPage: number, totalPages: number) => {
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

    const shortList = getPageNumbers(1, 4);
    expect(shortList).toEqual([1, 2, 3, 4]);

    const longListStart = getPageNumbers(1, 10);
    expect(longListStart).toEqual([1, 2, 3, 4, '...', 10]);

    const longListMiddle = getPageNumbers(5, 10);
    expect(longListMiddle).toEqual([1, '...', 4, 5, 6, '...', 10]);
  });
});
