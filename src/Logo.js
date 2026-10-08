import React from 'react';

export default function LogoComponent({ companyName, selectedCompany }) {
  // Determine which company's logo/name to display
  const currentComp = companyName || selectedCompany || 'Ram Reddy Developers';

  // Styling based on company theme
  const getCompanyDetails = () => {
    if (currentComp.includes('Fractio')) {
      return {
        title: 'Fractio',
        subtitle: 'HOSPITALITY',
        bg: '#fff',
        textColor: '#0f172a',
        accentColor: '#f97316', // Orange
        icon: '🏨',
        isImage: false // Image venumna inga true panni src kudukalam
      };
    } else if (currentComp.includes('Varnam') || currentComp.includes('Stories')) {
      return {
        title: 'Stories by Varnam',
        subtitle: 'STUDIO',
        bg: '#fff',
        textColor: '#0f172a',
        accentColor: '#3b82f6', // Blue
        icon: '🎨',
        isImage: false
      };
    } else {
      // Default: Ram Reddy Developers (INFRA)
      return {
        title: 'Ram Reddy',
        subtitle: 'DEVELOPERS (INFRA)',
        bg: '#fff',
        textColor: '#0f172a',
        accentColor: '#0ea5e9', // Sky Blue
        icon: '🏗️',
        isImage: false
      };
    }
  };

  const comp = getCompanyDetails();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      {/* Company Icon or Logo */}
      <div style={{ 
        width: '38px', 
        height: '38px', 
        background: '#f1f5f9', 
        borderRadius: '8px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        fontSize: '20px',
        border: '1px solid #e2e8f0',
        flexShrink: 0 
      }}>
        {comp.icon}
      </div>

      {/* Company Name & Subtitle */}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
        <span style={{ fontSize: '14px', fontWeight: '800', color: comp.textColor, letterSpacing: '-0.3px' }}>
          {comp.title}
        </span>
        <span style={{ fontSize: '10px', fontWeight: '700', color: comp.accentColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {comp.subtitle}
        </span>
      </div>
    </div>
  );
}