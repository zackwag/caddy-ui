function unwrap(node) {
    return node?.type === 'ChainExpression' ? node.expression : node;
}

function propertyName(node) {
    node = unwrap(node);
    if (node?.type !== 'MemberExpression') return null;

    if (!node.computed && node.property.type === 'Identifier') {
        return node.property.name;
    }

    return node.property.type === 'Literal'
        ? node.property.value
        : null;
}

function isToastObject(node) {
    node = unwrap(node);

    if (node?.type === 'Identifier') {
        return node.name === 'toast';
    }

    return propertyName(node) === 'current'
        && unwrap(node.object)?.type === 'Identifier'
        && node.object.name === 'toastRef';
}

function isTranslationCall(node) {
    const callee = unwrap(node.callee);
    const isTranslator = callee?.type === 'Identifier'
        && callee.name === 't';

    const key = node.arguments[0];

    return isTranslator
        && key?.type === 'Literal'
        && typeof key.value === 'string'
        && key.value.trim().length > 0;
}

function isLocalizedMessage(node) {
    node = unwrap(node);
    if (!node) return false;

    if (node.type === 'CallExpression') {
        if (isTranslationCall(node)) return true;

        return node.callee.type === 'Identifier'
            && node.callee.name === 'localizeError'
            && node.arguments.length === 2
            && node.arguments[0].type !== 'SpreadElement'
            && node.arguments[1].type === 'Identifier'
            && node.arguments[1].name === 't';
    }

    if (node.type === 'ConditionalExpression') {
        return isLocalizedMessage(node.consequent)
            && isLocalizedMessage(node.alternate);
    }

    if (
        node.type === 'LogicalExpression'
        && ['||', '??'].includes(node.operator)
    ) {
        return isLocalizedMessage(node.left)
            && isLocalizedMessage(node.right);
    }

    return false;
}

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Require localized error toast messages',
        },
        schema: [],
        messages: {
            localized:
                'Use t("catalog.key") or localizeError(error, t) for error toasts. Do not display raw errors or message variables.',
        },
    },

    create(context) {
        return {
            CallExpression(node) {
                const callee = unwrap(node.callee);

                if (
                    propertyName(callee) !== 'error'
                    || !isToastObject(callee.object)
                ) {
                    return;
                }

                if (!isLocalizedMessage(node.arguments[0])) {
                    context.report({
                        node: node.arguments[0] || node,
                        messageId: 'localized',
                    });
                }
            },
        };
    },
};