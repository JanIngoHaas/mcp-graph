export type TechTermType = 'Class' | 'Property' | 'Entity' | 'Domain' | 'Range' | 'Triple' | 'Instance' | 'Incoming';

export function renderTechTerm(techTerm: TechTermType, customFriendly?: string): string {
    let friendly = customFriendly;

    if (!friendly) {
        switch (techTerm) {
            case 'Class': friendly = 'Category'; break;
            case 'Property': friendly = 'Attribute'; break;
            case 'Entity': friendly = 'Data Entry'; break;
            case 'Domain': friendly = 'Available on'; break;
            case 'Range': friendly = 'Points to'; break;
            case 'Triple': friendly = 'Fact'; break;
            case 'Instance': friendly = 'Data Entry'; break;
            case 'Incoming': friendly = 'Referenced By'; break;
            default: friendly = techTerm;
        }
    }

    // Technical term badge appears after the friendly term with proper spacing
    // The span wrapper keeps them together, and the badge has left margin for spacing
    return `<span class="term-wrapper">${friendly} <span class="tech-term">${techTerm.toUpperCase()}</span></span>`;
}
