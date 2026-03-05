const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const generateWorkPermitPDF = async (permit) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            const filename = `Permit_${permit.permitId}_V1.pdf`;
            const filePath = path.join(__dirname, '../uploads/permits', filename);

            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Header - Branding
            doc.rect(0, 0, doc.page.width, 60).fill('#1e3a8a');
            doc.fillColor('white').fontSize(18).font('Helvetica-Bold').text('BALRAMPUR CHINI MILLS LIMITED', 30, 15);
            doc.fontSize(10).font('Helvetica').text('UNIT - AKBARPUR | INDUSTRIAL COMPLIANCE DIVISION', 30, 40);

            doc.fillColor('#ea580c').fontSize(14).font('Helvetica-Bold').text(`WORK PERMIT: ${permit.permitId}`, 30, 75);
            doc.fillColor('black').fontSize(10).font('Helvetica').text(`Status: ${permit.status} | Version: 1.0`, 30, 95);
            doc.text(`Generated on: ${new Date().toLocaleString()}`, 30, 110);
            doc.moveDown();

            // Section A: Work Type
            doc.rect(30, doc.y, 535, 20).fill('#f3f4f6');
            doc.fillColor('black').fontSize(10).font('Helvetica-Bold').text('SECTION A: TYPE OF WORK', 35, doc.y - 15);
            doc.moveDown(0.5);
            const workTypes = Object.entries(permit.typeOfWork || {})
                .filter(([_, v]) => v)
                .map(([k, _]) => k.replace(/([A-Z])/g, ' $1').toUpperCase());
            doc.fontSize(9).font('Helvetica').text(workTypes.join(' | ') || 'N/A', 35);
            doc.moveDown();

            // Section B: Job Details
            doc.rect(30, doc.y, 535, 20).fill('#f3f4f6');
            doc.fillColor('black').fontSize(10).font('Helvetica-Bold').text('SECTION B: JOB DETAILS', 35, doc.y - 15);
            doc.moveDown(0.5);
            doc.fontSize(9).font('Helvetica').text(`Dept: ${permit.jobDetails?.dept || 'N/A'} | Location: ${permit.jobDetails?.location || 'N/A'}`, 35);
            doc.text(`Equipment: ${permit.jobDetails?.equipmentName || 'N/A'} (${permit.jobDetails?.equipmentTagNo || 'N/A'})`, 35);
            doc.text(`Description: ${permit.jobDetails?.jobDescription || 'N/A'}`, 35);
            doc.moveDown();

            // Sections E, F, G - Hazards, Prep, PPE
            const sections = [
                { title: 'Hazards Identified', data: permit.hazards },
                { title: 'Preparation Made', data: permit.preparation },
                { title: 'PPE Required', data: permit.ppe }
            ];

            sections.forEach(sec => {
                doc.fontSize(10).font('Helvetica-Bold').text(sec.title.toUpperCase(), 35);
                doc.fontSize(9).font('Helvetica').text(sec.data?.join(', ') || 'None', 40);
                doc.moveDown(0.5);
            });
            doc.moveDown();

            // Section M: Workers
            if (permit.workers?.length > 0) {
                doc.fontSize(10).font('Helvetica-Bold').text('SECTION M: WORKER LIST', 35);
                permit.workers.forEach((w, i) => {
                    doc.fontSize(8).text(`${i + 1}. ${w.name} (${w.empCode})`, 40);
                });
                doc.moveDown();
            }

            // Signatures
            doc.rect(30, doc.y, 535, 20).fill('#f3f4f6');
            doc.fillColor('black').fontSize(10).font('Helvetica-Bold').text('AUTHORIZATIONS & APPROVALS', 35, doc.y - 15);
            doc.moveDown(0.5);

            // Requester
            doc.fontSize(9).text(`Requester Mobile: ${permit.requesterMobile || 'N/A'}`, 35);
            doc.text(`Engineer Mobile: ${permit.engineerMobile || 'N/A'}`, 35);

            // Approvers
            if (permit.approvers?.length > 0) {
                doc.moveDown();
                doc.fontSize(10).font('Helvetica-Bold').text('APPROVERS:', 35);
                permit.approvers.forEach(app => {
                    doc.fontSize(9).font('Helvetica').text(`${app.name || 'Unknown'} (${app.mobileNo}) - STATUS: ${app.status}`, 40);
                });
            }

            // Final Acceptance
            if (permit.certifications?.acceptor?.signature) {
                doc.moveDown();
                doc.fontSize(10).font('Helvetica-Bold').text('FINAL ACCEPTANCE:', 35);
                doc.fontSize(9).font('Helvetica').text(`Name: ${permit.certifications.acceptor.name} | Mobile: ${permit.certifications.acceptor.mobileNo}`, 40);
                doc.text(`Accepted on: ${permit.certifications.acceptor.date} at ${permit.certifications.acceptor.time}`, 40);

                // Drawing signature if possible (simplified for now as placeholder or text)
                doc.fontSize(8).fillColor('blue').text('[DIGITALLY SIGNED]', 40);
            }

            doc.end();
            stream.on('finish', () => resolve(filePath));
            stream.on('error', reject);
        } catch (err) {
            reject(err);
        }
    });
};

module.exports = { generateWorkPermitPDF };
