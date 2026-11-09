// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { cleanOcrText, ocrUsable } from '../import/ocr';
import { docxXmlToText } from '../import/resume';
import { classifyDocText, htmlToText, kindFromName } from '../import/route';

describe('kindFromName', () => {
  it('routes by extension and type', () => {
    expect(kindFromName('cert.JPG')).toBe('image');
    expect(kindFromName('Screenshot 2026-03-01.png', 'image/png')).toBe('image');
    expect(kindFromName('paste', 'image/png')).toBe('image');
    expect(kindFromName('resume.pdf')).toBe('pdf');
    expect(kindFromName('CV.docx')).toBe('docx');
    expect(kindFromName('Basic_LinkedInDataExport.zip')).toBe('archive');
    expect(kindFromName('conversations.json')).toBe('archive');
    expect(kindFromName('notes.md')).toBe('text');
    expect(kindFromName('slides.key')).toBe('unsupported');
  });
});

describe('classifyDocText', () => {
  it('spots a resume by its headings', () => {
    expect(classifyDocText('Ali Khan\nEDUCATION\nFAST NUCES\nPROJECTS\nFormVault\nSkills\nTypeScript')).toBe('resume');
  });
  it('spots a certificate', () => {
    expect(classifyDocText('CERTIFICATE OF PARTICIPATION\nThis is to certify that Ali Khan took part in HackNU 2025')).toBe('certificate');
  });
  it('falls back to a plain document', () => {
    expect(classifyDocText('Our team built a drone that maps crops. We used ROS and OpenCV.')).toBe('document');
  });
});

describe('docxXmlToText', () => {
  it('keeps paragraphs, tabs and entities', () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Ali &amp; Co</w:t></w:r></w:p><w:p><w:r><w:t>Role</w:t><w:tab/><w:t>Lead</w:t></w:r></w:p></w:body></w:document>';
    expect(docxXmlToText(xml)).toBe('Ali & Co\nRole\tLead');
  });
});

describe('OCR text', () => {
  it('drops junk lines from borders and icons', () => {
    expect(cleanOcrText('|||| ___\nCertificate of Achievement\n~ .\n  Awarded to   the team  \n=====')).toBe(
      'Certificate of Achievement\nAwarded to the team',
    );
  });
  it('judges whether OCR found enough', () => {
    expect(ocrUsable({ text: 'First place at HackNU for building FormVault together', confidence: 82 })).toBe(true);
    expect(ocrUsable({ text: 'Ab cd', confidence: 90 })).toBe(false);
    expect(ocrUsable({ text: 'First place at HackNU for building FormVault together', confidence: 20 })).toBe(false);
  });
});

describe('htmlToText', () => {
  it('reads visible words only', () => {
    expect(htmlToText('<html><head><style>p{}</style></head><body><h1>Hi</h1><script>x()</script><p>There</p></body></html>')).toMatch(/Hi\s*There/);
  });
});
