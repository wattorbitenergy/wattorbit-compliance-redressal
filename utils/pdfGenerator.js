const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const generateWorkPermitPDF = async (permit) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const filename = `Permit_${permit.permitId}_V1.pdf`;
            const filePath = path.join(__dirname, '../uploads/permits', filename);

            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            const pageWidth = doc.page.width - 100; // 50 margin each side

            // ─── HEADER ───
            doc.rect(0, 0, doc.page.width, 80).fill('#1e3a8a');
            doc.fillColor('white').fontSize(20).font('Helvetica-Bold')
                .text('BALRAMPUR CHINI MILLS LIMITED', 50, 20, { align: 'center', width: pageWidth });
            doc.fontSize(11).font('Helvetica')
                .text('UNIT - AKBARPUR  |  INDUSTRIAL COMPLIANCE DIVISION', 50, 48, { align: 'center', width: pageWidth });

            // ─── PERMIT ID & META ───
            doc.moveDown(1.5);
            doc.fillColor('#ea580c').fontSize(16).font('Helvetica-Bold')
                .text(`WORK PERMIT: ${permit.permitId}`, 50);
            doc.moveDown(0.3);
            doc.fillColor('#333').fontSize(10).font('Helvetica')
                .text(`Status: ${permit.status}  |  Generated: ${new Date().toLocaleString()}`, 50);
            doc.moveDown(1.5);

            // ─── Helper Functions ───
            const sectionHeader = (title) => {
                doc.moveDown(0.5);
                const y = doc.y;
                doc.rect(50, y, pageWidth, 24).fill('#e5e7eb');
                doc.fillColor('#111').fontSize(11).font('Helvetica-Bold')
                    .text(title, 58, y + 6);
                doc.y = y + 32;
            };

            const labelValue = (label, value) => {
                doc.fontSize(9).font('Helvetica-Bold').fillColor('#555')
                    .text(`${label}:  `, 58, doc.y, { continued: true });
                doc.font('Helvetica').fillColor('#111')
                    .text(value || 'N/A');
            };

            const checklistGroup = (title, items) => {
                if (!items || items.length === 0) return;
                doc.fontSize(9).font('Helvetica-Bold').fillColor('#444').text(`${title}:`, 58);
                doc.moveDown(0.2);
                doc.fontSize(8).font('Helvetica').fillColor('#333')
                    .text(items.join('  •  '), 66, doc.y, { width: pageWidth - 20 });
                doc.moveDown(0.5);
            };

            // ─── PAGE 1 ───

            // SECTION A: TYPE OF WORK
            sectionHeader('SECTION A: TYPE OF WORK');
            const workTypes = Object.entries(permit.typeOfWork || {})
                .filter(([_, v]) => v)
                .map(([k]) => k.replace(/([A-Z])/g, ' $1').trim().toUpperCase());
            doc.fontSize(10).font('Helvetica').fillColor('#111')
                .text(workTypes.join('  •  ') || 'N/A', 58);
            doc.moveDown(0.8);

            // SECTION B: JOB DETAILS
            sectionHeader('SECTION B: JOB DETAILS');
            labelValue('Department', permit.jobDetails?.dept);
            labelValue('Location', permit.jobDetails?.location);
            labelValue('Equipment', `${permit.jobDetails?.equipmentName || 'N/A'} (Tag: ${permit.jobDetails?.equipmentTagNo || 'N/A'})`);
            doc.moveDown(0.3);
            labelValue('Job Description', permit.jobDetails?.jobDescription);
            doc.moveDown(0.8);

            // SECTION C & D: NATURE & TOOLS
            sectionHeader('SECTION C & D: SCOPE & TOOLS');
            checklistGroup('C. Nature of Work', permit.natureOfWork);
            checklistGroup('D. Tools & Equipment', permit.toolsAndEquipment);
            doc.moveDown(0.5);

            // SECTION E, F, G: SAFETY
            sectionHeader('SECTION E, F, G: SAFETY CHECKLISTS');
            checklistGroup('E. Hazards Identified', permit.hazards);
            checklistGroup('F. Preparation Made', permit.preparation);
            checklistGroup('G. PPE Required', permit.ppe);
            doc.moveDown(0.5);

            // SECTION H: ISOLATION
            if (permit.isolation?.name) {
                sectionHeader('SECTION H: ISOLATION CERTIFICATION');
                doc.fontSize(8).font('Helvetica-Oblique').fillColor('#b91c1c')
                    .text('I certify that the machine/equipment is isolated from every source of energy by Switching off /fuse removal/LOTO/Mechanical Isolation etc.', 58);
                doc.moveDown(0.3);
                labelValue('Certified By', `${permit.isolation.name}  |  Date: ${permit.isolation.date || 'N/A'}  |  Time: ${permit.isolation.time || 'N/A'}`);
                doc.moveDown(0.8);
            }

            // ─── PAGE 2 ───
            doc.addPage();

            // SECTION I: GAS TEST RECORD
            if (permit.gasTestLogs?.length > 0) {
                sectionHeader('SECTION I: GAS TEST RECORD');
                const startY = doc.y;
                const cols = [50, 100, 150, 210, 260, 310, 360, pageWidth + 50];
                const headers = ['Date', 'Time', 'Flam %', 'O2', 'CO', 'H2S/SO2', 'Tester'];

                // Table Headers bg
                doc.rect(50, startY, pageWidth, 20).fill('#f3f4f6');
                doc.fillColor('#111').fontSize(8).font('Helvetica-Bold');
                headers.forEach((h, i) => doc.text(h, cols[i] + 5, startY + 6));

                let currentY = startY + 20;
                permit.gasTestLogs.forEach(log => {
                    doc.rect(50, currentY, pageWidth, 20).stroke('#ddd');
                    doc.fillColor('#333').fontSize(7).font('Helvetica');
                    doc.text(String(log.date || '').split('T')[0], cols[0] + 5, currentY + 6);
                    doc.text(log.time || '', cols[1] + 5, currentY + 6);
                    doc.text(log.flammablePercentage || '', cols[2] + 5, currentY + 6);
                    doc.text(log.o2 || '', cols[3] + 5, currentY + 6);
                    doc.text(log.co || '', cols[4] + 5, currentY + 6);
                    doc.text(log.so2_h2s || '', cols[5] + 5, currentY + 6);
                    doc.text(log.testedBy || '', cols[6] + 5, currentY + 6);
                    currentY += 20;
                });
                doc.y = currentY + 10;
            }

            // SECTION M: WORKER LIST
            if (permit.workers?.length > 0) {
                sectionHeader('SECTION M: WORKER LIST');
                permit.workers.forEach((w, i) => {
                    doc.fontSize(8).font('Helvetica').fillColor('#111')
                        .text(`${i + 1}. ${w.name || 'N/A'}  (Code/Vendor: ${w.empCode || 'N/A'})`, 58);
                });
                doc.moveDown(0.8);
            }

            // RENEWAL RECORDS
            if (permit.renewals?.length > 0) {
                sectionHeader('PERMIT RENEWAL RECORD');
                permit.renewals.forEach((r, i) => {
                    doc.fontSize(8).font('Helvetica').fillColor('#111')
                        .text(`${i + 1}. ${r.date} | ${r.timeFrom}-${r.timeTo} | Issuer: ${r.issuerName} | Acceptor: ${r.acceptorName}`, 58);
                });
                doc.moveDown(0.8);
            }

            // SECTION N: CLOSURE
            if (permit.closure?.status) {
                sectionHeader('SECTION N: PERMIT CLOSURE');
                labelValue('Closure Status', permit.closure.status);
                if (permit.closure.reason) labelValue('Reason', permit.closure.reason);
                doc.moveDown(0.5);

                doc.fontSize(8).font('Helvetica-Bold').text('Authorizations:', 58);
                doc.fontSize(8).font('Helvetica').fillColor('#333');
                doc.text(`Power Restored: ${permit.closure.powerRestoredBy?.name || 'N/A'} (Date: ${permit.closure.powerRestoredBy?.date || 'N/A'})`, 66);
                doc.text(`Acceptor Sign-off: ${permit.closure.acceptor?.name || 'N/A'} (Date: ${permit.closure.acceptor?.date || 'N/A'})`, 66);
                doc.text(`Issuer Sign-off: ${permit.closure.issuer?.name || 'N/A'} (Date: ${permit.closure.issuer?.date || 'N/A'})`, 66);
                doc.moveDown(0.8);
            }

            // AUTHORIZATIONS (Main Approvers)
            sectionHeader('INITIAL APPROVALS');
            if (permit.approvers?.length > 0) {
                permit.approvers.forEach((app, i) => {
                    doc.fontSize(9).font('Helvetica').fillColor('#111')
                        .text(`${i + 1}. ${app.name || 'Unknown'} (${app.mobileNo}) — ${app.status} ${app.updatedAt ? '(On: ' + new Date(app.updatedAt).toLocaleString() + ')' : ''}`, 58);
                });
            }

            // ─── FOOTER ───
            const footerY = doc.page.height - 50;
            doc.fontSize(7).fillColor('#999').font('Helvetica')
                .text('This document is system-generated by WattOrbit Industrial Compliance. Verification via permitId on portal.', 50, footerY, { align: 'center', width: pageWidth });

            doc.end();
            stream.on('finish', () => resolve(filePath));
            stream.on('error', reject);
        } catch (err) {
            reject(err);
        }
    });
};

module.exports = { generateWorkPermitPDF };
