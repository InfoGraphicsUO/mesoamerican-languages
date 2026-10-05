// shared ui tools for safe html
// exports escape, raw, html

// turn any value into safe text before it gets added to html
// null/undefined = empty string
export function escape(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;'); // replace chars that browser might read as markup
}

// mark a string as safe html so html`` leaves it alone
// String(fragment) still gives back the finished markup
export function raw(value) {
    const markup = String(value ?? '');
    return { __html: markup, toString: () => markup };
}

// tagged template func, regular values get escaped before going into html
// raw()/html`` fragments and lists can be nested w/o getting escaped again
export function html(strings, ...values) {
    const render = (value) => {
        if (Array.isArray(value)) return value.map(render).join(''); // render list items and combine into one string
        if (value && typeof value === 'object' && '__html' in value) return value.__html; // already safe, dont escape twice
        return escape(value); // anything else becomes safe text
    };

    // combine template parts w/ rendered values and return another safe fragment
    return raw(strings.reduce((out, part, i) => out + part + (i < values.length ? render(values[i]) : ''), ''));
}
