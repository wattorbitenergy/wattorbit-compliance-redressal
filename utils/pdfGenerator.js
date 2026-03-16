const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const generateWorkPermitPDF = async (permit) => {
    return new Promise((resolve, reject) => {
        const filename = `Permit_${permit.permitId}_V1.pdf`;
        const finalPath = path.join(__dirname, '../uploads/permits', filename);
        // Atomic write: use a temp file and rename only on success
        const tempPath = `${finalPath}.tmp`;

        try {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            
            const dir = path.dirname(finalPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const stream = fs.createWriteStream(tempPath);
            doc.pipe(stream);

            const pageWidth = doc.page.width - 60;
            // Use bundled font in assets for cross-platform compatibility
            const HINDI_FONT = path.join(__dirname, '../assets/aparajita.ttf');

            // Register Fonts
            if (fs.existsSync(HINDI_FONT)) {
                doc.registerFont('Aparajita', HINDI_FONT);
            } else {
                console.warn('Aparajita font not found, falling back to Helvetica');
                // Use a standard font as fallback to prevent crash
                doc.registerFont('Aparajita', 'Helvetica');
            }

            // ─── Constants for Form Options (Synced with Hard Copy) ───
            const OPTIONS = {
                typeOfWork: [
                    { key: 'coldWork', en: 'Cold Work', hi: 'कोल्ड वर्क' },
                    { key: 'hotWork', en: 'Hot Work', hi: 'हॉट वर्क' },
                    { key: 'confinedSpace', en: 'Confined Space/Vessel Entry', hi: 'सीमित स्थान/वेसल एंट्री' },
                    { key: 'excavation', en: 'Excavation', hi: 'एक्सकैवेशन/खनन' },
                    { key: 'workAtHeight', en: 'Work at Height', hi: 'ऊंचाई पर काम' },
                    { key: 'electrical', en: 'Electrical', hi: 'इलेक्ट्रिकल' }
                ],
                nature: [
                    { en: "Work at Height", hi: "ऊंचाई पर काम" }, { en: "Welding/Gas Cutting", hi: "वेल्डिंग/गैस कटिंग" },
                    { en: "Hot Tapping", hi: "हॉट टैपिंग" }, { en: "Opening Line/ Equipment", hi: "ओपनिंग लाइन/उपकरण" },
                    { en: "Excavation", hi: "खनन/खुदाई" }, { en: "Radiation Sources", hi: "विकिरण स्रोत" },
                    { en: "Insulation", hi: "इन्सुलेशन" }, { en: "Material Handling", hi: "मटेरियल हैंडलिंग" },
                    { en: "Painting", hi: "पेंटिंग" }, { en: "Work on Electrical System", hi: "इलेक्ट्रिकल सिस्टम पर काम" },
                    { en: "Electrical Lockout", hi: "इलेक्ट्रिकल लॉकआउट" }, { en: "Mechanical Lockout", hi: "मैकेनिकल लॉकआउट" },
                    { en: "Work on Fragile Roofs", hi: "कमजोर छत/सतह पर काम" }, { en: "Closure of Roads Work", hi: "सड़क का बंद होना" },
                    { en: "Inst. Systems", hi: "इंस्ट्रूमेंट सिस्टम पर काम" }, { en: "Others", hi: "अन्य" }
                ],
                hazards: [
                    { en: "Fire Hazard", hi: "आग से खतरा" }, { en: "Fall from Height", hi: "ऊंचाई से गिरने का" },
                    { en: "Oxygen Deficiency", hi: "ऑक्सीजन की कमी" }, { en: "Toxic Gas Exposure", hi: "विषाक्त गैसों का होना" },
                    { en: "Electrical Shock", hi: "बिजली का झटका" }, { en: "Corrosive Mat.", hi: "संक्षारक सामग्री" },
                    { en: "Radiation Hazard", hi: "विकिरण का खतरा" }, { en: "Hot Surface", hi: "गर्म सतह" },
                    { en: "Stored Energy", hi: "संग्रहीत ऊर्जा" }, { en: "Crush/Cut Injury", hi: "दबना/कटना" },
                    { en: "Pressurized Equip.", hi: "दबाव वाले उपकरण" }, { en: "Noise Exposure", hi: "शोर का होना" },
                    { en: "Dust Exposure", hi: "धूल का होना" }, { en: "Others", hi: "अन्य" }
                ],
                prep: [
                    { en: "Isolation", hi: "आइसोलेशन" }, { en: "Equip./Pipe Blinded", hi: "ब्लाइन्ड" },
                    { en: "Grounding Elec.", hi: "ग्राउंडिंग" }, { en: "Barricading Area", hi: "बैरिकेडिंग" },
                    { en: "Protect from Spark", hi: "चिंगारी सुरक्षा" }, { en: "Height Proc. Comp.", hi: "हाइट प्रोसीजर" },
                    { en: "Excavation Cleared", hi: "खुदाई मंजूरी" }, { en: "Confined Space Entry", hi: "सीमित स्थान" },
                    { en: "Special Inst.", hi: "विशेष निर्देश" }, { en: "De-pressurized", hi: "दबाव रहित" },
                    { en: "24V Lamp Use", hi: "24V लैंप" }, { en: "Vehicle Entry Proc.", hi: "वाहन प्रवेश" },
                    { en: "Hot Work Proc.", hi: "हॉट कार्य" }, { en: "LOTO Proc.", hi: "LOTO" },
                    { en: "Scaffold Safety", hi: "भाड़ा सुरक्षा" }, { en: "Stand-by Person", hi: "स्टैंड-बाय" },
                    { en: "Fire Watcher", hi: "फायर वॉचर" }, { en: "Rescue Plan", hi: "रेस्क्यू प्लान" },
                    { en: "Road Closed", hi: "रोड बंद" }, { en: "Atmos. Tested", hi: "वायुमंडल परीक्षण" },
                    { en: "HIRA Completed", hi: "HIRA पूरा" }
                ],
                ppe: [
                    { en: "Safety Helmet", hi: "हेलमेट" }, { en: "Gum Boot", hi: "गम बूट" },
                    { en: "Dust mask", hi: "डस्ट मास्क" }, { en: "Safety Glasses", hi: "चश्मा" },
                    { en: "Fire Extinguishers", hi: "फायर एक्स।" }, { en: "Gloves", hi: "दस्ताने" },
                    { en: "Ear Plugs", hi: "ईयर प्लग" }, { en: "Splash Goggles", hi: "स्प्लैश चश्मा" },
                    { en: "Fire Water/Hose", hi: "होज रील" }, { en: "Gas Mask", hi: "गैस मास्क" },
                    { en: "Ear Muffs", hi: "ईयर मफ" }, { en: "Fire blanket", hi: "कंबल" },
                    { en: "Leg/Arm Guards", hi: "लेग गार्ड" }, { en: "Face Shield", hi: "फेस शील्ड" },
                    { en: "SCBA", hi: "SCBA" }, { en: "Protective suit", hi: "सूट" },
                    { en: "Safety Harness", hi: "हार्नेस" }, { en: "Others", hi: "अन्य" }
                ],
                tools: [
                    { en: "Welding Machine", hi: "वेल्डिंग मशीन" }, { en: "Gas Cylinders", hi: "सिलिंडर" },
                    { en: "Man Lift", hi: "मैन लिफ्ट" }, { en: "Non-Sparking", hi: "नॉन-स्पार्किंग" },
                    { en: "Mobile Crane", hi: "मोबाइल क्रेन" }, { en: "Fixed Cranes", hi: "फिक्स्ड क्रेन" },
                    { en: "Lifting Tools", hi: "लिफ्टिंग टूल्स" }, { en: "Electric Tools", hi: "इलेक्ट्रिक टूल्स" },
                    { en: "Scaffold", hi: "भाड़ा" }, { en: "Ladder", hi: "सीढ़ी" },
                    { en: "Hydraulic Tools", hi: "हाइड्रोलिक टूल्स" }, { en: "Others", hi: "अन्य" }
                ]
            };

            // ─── Drawing Helpers ───
            const drawCheckbox = (x, y, checked) => {
                doc.save();
                doc.rect(x, y, 7, 7).lineWidth(0.5).stroke('#000');
                if (checked) {
                    doc.fontSize(7).fillColor('#000').font('Helvetica-Bold').text('X', x + 1, y - 0.5);
                }
                doc.restore();
            };

            const sectionHeader = (id, title, hiTitle) => {
                const y = doc.y;
                doc.rect(30, y, pageWidth, 15).fill('#E2E8F0');
                doc.fillColor('#000').fontSize(8).font('Helvetica-Bold').text(`Section ${id}: ${title}`, 35, y + 4, { continued: true });
                doc.font('Aparajita').fontSize(9).text(` (${hiTitle})`);
                doc.y = y + 18;
            };

            const drawSignatureLine = (label, cert, x, y) => {
                doc.fontSize(7).font('Helvetica-Bold').fillColor('#000').text(label, x, y);
                doc.fontSize(7).font('Helvetica').text(`Name:`, x, y + 12);
                doc.fontSize(8).font('Aparajita').text(cert?.name || '____________________', x + 25, y + 12);
                doc.fontSize(7).font('Helvetica').text(`Sig: ____________________`, x, y + 24);
                doc.text(`Date: ${cert?.date || '__________'}   Time: ${cert?.time || '__________'}`, x, y + 36);
                
                if (cert?.signature && typeof cert.signature === 'string' && cert.signature.startsWith('data:image')) {
                    const method = cert.signatureMethod;
                    if (method === 'digital') {
                        doc.fontSize(6).font('Helvetica-Bold').fillColor('#059669').text('[DIGITALLY VERIFIED]', x + 30, y + 24);
                    } else {
                        try {
                            const buffer = Buffer.from(cert.signature.replace(/^data:image\/\w+;base64,/, ""), 'base64');
                            doc.image(buffer, x + 35, y + 20, { width: 45, height: 18 });
                        } catch (e) {
                            console.error('Error drawing signature image:', e.message);
                        }
                    }
                }
            };

            const drawHybridText = (en, hi, x, y, size = 6) => {
                doc.fontSize(size).font('Helvetica').fillColor('#000').text(en, x, y, { continued: true });
                doc.font('Aparajita').fontSize(size + 2).text(` (${hi})`);
            };

            // ─── PAGE 1 ───
            // Header
            doc.fontSize(16).font('Helvetica-Bold').text('Balrampur', { align: 'center' });
            doc.fontSize(9).font('Helvetica').text('Chini Mills Limited\nUNIT - AKBARPUR', { align: 'center' });
            doc.fontSize(14).font('Helvetica-Bold').text('PERMIT TO WORK', { align: 'center' });
            doc.fontSize(8).font('Helvetica-Bold').text(`Work Permit No.: A ${permit.permitId || '______'}`, pageWidth - 80, 45, { align: 'right' });
            doc.moveDown(0.5);

            // A
            sectionHeader('A', 'Type of Work', 'किस प्रकार का कार्य करना');
            let sx = 40; let sy = doc.y;
            OPTIONS.typeOfWork.forEach((opt, i) => {
                const c = i % 3; const r = Math.floor(i / 3);
                const ox = sx + (c * 175); const oy = sy + (r * 12);
                drawCheckbox(ox, oy, permit.typeOfWork?.[opt.key]);
                drawHybridText(opt.en, opt.hi, ox + 10, oy + 0.5, 6);
            });
            doc.y = sy + 25;

            // B
            sectionHeader('B', 'Job Details', 'कार्य का विवरण');
            doc.fontSize(7).font('Helvetica-Bold').text('Dept:', 40, doc.y, { continued: true });
            doc.font('Helvetica').text(` ${permit.jobDetails?.dept || '__________'} `, { continued: true });
            doc.font('Helvetica-Bold').text(' Location:', { continued: true });
            doc.font('Helvetica').text(` ${permit.jobDetails?.location || '____________________'}`);
            
            doc.font('Helvetica-Bold').text('Equipment:', 40, doc.y, { continued: true });
            doc.font('Helvetica').text(` ${permit.jobDetails?.equipmentName || '__________'} `, { continued: true });
            doc.font('Helvetica-Bold').text(' Tag No:', { continued: true });
            doc.font('Helvetica').text(` ${permit.jobDetails?.equipmentTagNo || '__________'}`);
            
            doc.font('Helvetica-Bold').text('Description:', 40, doc.y, { continued: true });
            doc.font('Helvetica').text(` ${permit.jobDetails?.jobDescription || '____________________'}`);
            
            doc.font('Helvetica-Bold').text('Execution By:', 40, doc.y, { continued: true });
            doc.font('Helvetica').text(` ${permit.jobDetails?.executionBy || '__________'} `, { continued: true });
            doc.font('Helvetica-Bold').text(' Persons at Work:', { continued: true });
            doc.font('Helvetica').text(` ${permit.jobDetails?.personsAtWork || '___'}`);
            doc.moveDown(0.5);

            // C & D
            sectionHeader('C', 'Nature of Work', 'कार्य की प्रकृति');
            sy = doc.y;
            OPTIONS.nature.forEach((opt, i) => {
                const c = i % 2; const r = Math.floor(i / 2);
                const ox = 40 + (c * 240); const oy = sy + (r * 11);
                drawCheckbox(ox, oy, permit.natureOfWork?.includes(opt.en));
                drawHybridText(opt.en, opt.hi, ox + 12, oy + 0.5, 6);
            });
            doc.y = sy + 95;

            sectionHeader('D', 'Tools & Equipment', 'उपकरण और सामग्री');
            sy = doc.y;
            OPTIONS.tools.forEach((opt, i) => {
                const c = i % 2; const r = Math.floor(i / 2);
                const ox = 40 + (c * 240); const oy = sy + (r * 11);
                drawCheckbox(ox, oy, permit.toolsAndEquipment?.includes(opt.en));
                drawHybridText(opt.en, opt.hi, ox + 12, oy + 0.5, 6);
            });
            doc.y = sy + 70;

            // E & G
            sectionHeader('E', 'Hazard/Risk Considerations', 'खतरे');
            sy = doc.y;
            OPTIONS.hazards.forEach((opt, i) => {
                const c = i % 2; const r = Math.floor(i / 2);
                const ox = 40 + (c * 240); const oy = sy + (r * 11);
                drawCheckbox(ox, oy, permit.hazards?.includes(opt.en));
                drawHybridText(opt.en, opt.hi, ox + 12, oy + 0.5, 6);
            });
            doc.y = sy + 85;

            sectionHeader('G', 'PPE and Fire Protection', 'आवश्यक पीपीई');
            sy = doc.y;
            OPTIONS.ppe.forEach((opt, i) => {
                const c = i % 3; const r = Math.floor(i / 3);
                const ox = 40 + (c * 175); const oy = sy + (r * 11);
                drawCheckbox(ox, oy, permit.ppe?.includes(opt.en));
                drawHybridText(opt.en, opt.hi, ox + 12, oy + 0.5, 6);
            });
            doc.y = sy + 70;

            // F
            sectionHeader('F', 'Job/Equipment Preparation', 'की गई तैयारी');
            sy = doc.y;
            OPTIONS.prep.forEach((opt, i) => {
                const c = i % 2; const r = Math.floor(i / 2);
                const ox = 40 + (c * 240); const oy = sy + (r * 9.5);
                drawCheckbox(ox, oy, permit.preparation?.includes(opt.en));
                drawHybridText(opt.en, opt.hi, ox + 12, oy + 0.5, 5.5);
            });
            doc.y = sy + 105;

            // H, J, K, L (Signatures)
            const ySigs = doc.y;
            drawSignatureLine('H. Isolation Certification', permit.isolation, 40, ySigs);
            drawSignatureLine('J. Permit Issuer', permit.certifications?.issuer, 290, ySigs);
            
            const spaceY = 55;
            drawSignatureLine('L. Permit Acceptor', permit.certifications?.acceptor, 40, ySigs + spaceY);
            drawSignatureLine('K. Permit Approver', permit.certifications?.approver, 290, ySigs + spaceY);

            // ─── PAGE 2 ───
            doc.addPage();
            doc.y = 35;

            // M
            sectionHeader('M', 'Name of individual working', 'कार्य करने वाले व्यक्तियों का नाम');
            const rowH = 15;
            doc.rect(40, doc.y, pageWidth, rowH * 11).stroke();
            doc.fontSize(7).font('Helvetica-Bold').text('NAME', 50, doc.y + 5);
            doc.text('Emp. Code', 155, doc.y + 5);
            doc.text('NAME', 290, doc.y + 5);
            doc.text('Emp. Code', 395, doc.y + 5);
            
            let my = doc.y + rowH;
            (permit.workers || []).slice(0, 20).forEach((w, i) => {
                const c = i % 2; const r = Math.floor(i / 2);
                doc.fontSize(8).font('Aparajita').text(w.name || '', 50 + (c * 240), my + (r * rowH) + 3);
                doc.fontSize(7).font('Helvetica').text(w.empCode || '', 155 + (c * 240), my + (r * rowH) + 3);
            });
            doc.y = my + (rowH * 10) + 10;

            // RENEWAL
            sectionHeader('RENEWAL', 'Permit Renewal Record', 'नवीनीकरण रिकॉर्ड');
            doc.rect(40, doc.y, pageWidth, 60).stroke();
            doc.fontSize(6).font('Helvetica-Bold').text('DATE | TIME | ISSUER SIG | ACCEPTOR SIG', 50, doc.y + 5);
            doc.y += 75;

            // GAS TEST
            sectionHeader('I', 'Gas Test Record', 'गैस परीक्षण रिकॉर्ड');
            doc.rect(40, doc.y, pageWidth, 80).stroke();
            doc.fontSize(6).font('Helvetica-Bold').text('DATE | TIME | LEL% | O2 | CO | SO2/H2S | TESTED BY | SIG', 50, doc.y + 5);
            doc.y += 95;

            // N
            sectionHeader('N', 'Permit Closure/Cancellation', 'परमिट बंद/रद्द करना');
            const yN = doc.y;
            drawCheckbox(40, yN, permit.closure?.status?.includes('Completed')); 
            drawHybridText('Job Completed & Housekeeping restored', 'कार्य पूर्ण एवं साइट साफ किया गया है', 55, yN + 1);
            
            drawCheckbox(40, yN + 15, permit.closure?.status?.includes('new Permit')); 
            drawHybridText('Job to be Completed. Issue a new Permit', 'कार्य पूर्ण करना है, कृपया नया परमिट जारी करें', 55, yN + 16);
            
            const syN = yN + 40;
            drawSignatureLine('Power Restored by', permit.closure?.powerRestoredBy, 40, syN);
            drawSignatureLine('Permit Acceptor', permit.closure?.acceptor, 200, syN);
            drawSignatureLine('Permit Issuer', permit.closure?.issuer, 380, syN);

            doc.end();

            stream.on('finish', () => {
                try {
                    fs.renameSync(tempPath, finalPath);
                    resolve(finalPath);
                } catch (renameErr) {
                    reject(renameErr);
                }
            });

            stream.on('error', (streamErr) => {
                // Cleanup temp file on stream error
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                reject(streamErr);
            });

            doc.on('error', (docErr) => {
                // Cleanup temp file on doc error
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                reject(docErr);
            });

        } catch (err) {
            // Final cleanup
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            reject(err);
        }
    });
};

module.exports = { generateWorkPermitPDF };
