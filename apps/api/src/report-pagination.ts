import type { Page } from "playwright";

// Measure at the actual A4 print width, then balance each chapter across pages.
// This avoids a nearly empty overflow page after a long chart or paragraph.
export async function paginateProfessionalReport(page: Page) {
  await page.emulateMedia({ media: "print" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.body.style.width = "174mm";
    const pageLimit = 976; // A4 minus 17/18 mm margins, with rounding allowance.
    const chapters = [...document.querySelectorAll<HTMLElement>(".report-page:not(.report-cover)")];
    for (const chapter of chapters) {
      const elements = [...chapter.children] as HTMLElement[];
      const heading = document.createElement("div");
      heading.className = "report-heading";
      elements.slice(0, 4).forEach(element => heading.append(element.cloneNode(true)));
      const blocks = elements.slice(4).map(element => element.cloneNode(true) as HTMLElement);
      const measure = document.createElement("section");
      measure.className = "report-page";
      measure.style.cssText = "position:absolute;visibility:hidden;width:174mm;display:flow-root";
      const body = document.createElement("div");
      body.className = "report-body";
      measure.append(heading.cloneNode(true), body);
      document.body.append(measure);
      const measureRange = {
        height(items: HTMLElement[]) {
          body.replaceChildren(...items.map(item => item.cloneNode(true)));
          return measure.getBoundingClientRect().height;
        },
      };
      // Break only at semantic boundaries. Long tables repeat their header.
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (measureRange.height([block]) <= pageLimit) continue;
        let parts: HTMLElement[] = [];
        if (block.tagName === "TABLE") {
          const rows = [...block.querySelectorAll("tbody > tr")];
          if (rows.length > 1) {
            let group: Element[] = [];
            for (const row of rows) {
              const copy = block.cloneNode(true) as HTMLElement;
              copy.querySelector("tbody")!.replaceChildren(...[...group, row].map(item => item.cloneNode(true)));
              if (group.length && measureRange.height([copy]) > pageLimit) {
                const complete = block.cloneNode(true) as HTMLElement;
                complete.querySelector("tbody")!.replaceChildren(...group.map(item => item.cloneNode(true)));
                parts.push(complete);
                group = [];
              }
              group.push(row);
            }
            if (group.length) {
              const complete = block.cloneNode(true) as HTMLElement;
              complete.querySelector("tbody")!.replaceChildren(...group.map(item => item.cloneNode(true)));
              parts.push(complete);
            }
            // Distribute rows evenly so the final sheet does not contain one row.
            for (let count = parts.length; count <= rows.length; count++) {
              const balanced: HTMLElement[] = [];
              let offset = 0;
              for (let part = 0; part < count; part++) {
                const length = Math.ceil((rows.length - offset) / (count - part));
                const copy = block.cloneNode(true) as HTMLElement;
                copy.querySelector("tbody")!.replaceChildren(...rows.slice(offset, offset + length).map(item => item.cloneNode(true)));
                balanced.push(copy);
                offset += length;
              }
              if (balanced.every(copy => measureRange.height([copy]) <= pageLimit)) { parts = balanced; break; }
            }
            if (parts.length === 1) parts = [];
          }
        } else if (block.matches(".chart-card, .facet-grid")) {
          const items = [...block.querySelectorAll(":scope > .metric")];
          if (items.length > 1) {
            const middle = Math.ceil(items.length / 2);
            parts = [items.slice(0, middle), items.slice(middle)].map(group => {
              const copy = block.cloneNode(true) as HTMLElement;
              copy.querySelectorAll(":scope > .metric").forEach(metric => metric.remove());
              copy.append(...group.map(metric => metric.cloneNode(true)));
              return copy;
            });
          }
        } else if (block.tagName === "P") {
          const words = (block.textContent || "").split(/\s+/);
          if (words.length > 20) {
            const middle = Math.ceil(words.length / 2);
            parts = [words.slice(0, middle), words.slice(middle)].map(group => {
              const copy = block.cloneNode(false) as HTMLElement;
              copy.textContent = group.join(" ");
              return copy;
            });
          }
        }
        if (parts.length) { blocks.splice(i, 1, ...parts); i--; }
        // Oversized compound content retains normal browser pagination; never clip it.
      }
      const n = blocks.length;
      const best = Array(n + 1).fill(Infinity);
      const next = Array(n).fill(0);
      best[n] = 0;
      for (let from = n - 1; from >= 0; from--) {
        for (let to = from + 1; to <= n; to++) {
          const h = measureRange.height(blocks.slice(from, to));
          if (h > pageLimit && to > from + 1) break;
          if (/^H[1-6]$/.test(blocks[to - 1].tagName) && to < n) continue;
          const cost = 1e9 + Math.pow(Math.max(0, pageLimit - h), 2) + best[to];
          if (cost < best[from]) { best[from] = cost; next[from] = to; }
        }
      }
      const pages: HTMLElement[] = [];
      for (let from = 0; from < n;) {
        const to = next[from] || from + 1;
        const sheet = document.createElement("section");
        sheet.className = "report-page";
        const sheetBody = document.createElement("div");
        sheetBody.className = "report-body";
        sheetBody.append(...blocks.slice(from, to));
        sheet.append(heading.cloneNode(true), sheetBody);
        pages.push(sheet);
        from = to;
      }
      measure.remove();
      if (pages.length) chapter.replaceWith(...pages);
    }
  });
}
