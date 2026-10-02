/**
 * ODS Parser — Parses OpenDocument Spreadsheet files in the browser.
 * Requires JSZip (global) loaded via CDN.
 */
class ODSParser {
    static async parse(file) {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const xml = await zip.file('content.xml').async('string');
        return ODSParser._parseXML(xml);
    }

    static _parseXML(xmlString) {
        const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
        const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
        const TEXT_NS  = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';

        const sheet = doc.getElementsByTagNameNS(TABLE_NS, 'table')[0];
        if (!sheet) throw new Error('Planilha não encontrada no arquivo ODS.');

        const rows = sheet.getElementsByTagNameNS(TABLE_NS, 'table-row');
        const contests = [];

        for (let i = 1; i < rows.length; i++) {
            const cells = rows[i].getElementsByTagNameNS(TABLE_NS, 'table-cell');
            const vals = [];
            for (let j = 0; j < cells.length && vals.length < 8; j++) {
                const cell = cells[j];
                const ps = cell.getElementsByTagNameNS(TEXT_NS, 'p');
                const repeat = parseInt(
                    cell.getAttributeNS(TABLE_NS, 'number-columns-repeated') || '1'
                );
                if (ps.length > 0) {
                    vals.push(ps[0].textContent.trim());
                } else {
                    for (let r = 0; r < repeat && vals.length < 8; r++) vals.push('');
                }
            }

            if (!vals[0] || isNaN(parseInt(vals[0]))) continue;
            const nums = [vals[2], vals[3], vals[4], vals[5], vals[6], vals[7]].map(Number);
            if (nums.length !== 6 || nums.some(isNaN)) continue;

            contests.push({
                concurso: parseInt(vals[0]),
                data: vals[1] || '',
                numbers: nums.sort((a, b) => a - b)
            });
        }

        return contests.sort((a, b) => a.concurso - b.concurso);
    }
}

