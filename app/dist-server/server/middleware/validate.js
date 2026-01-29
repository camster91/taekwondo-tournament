/**
 * Express middleware factory for Zod validation
 *
 * @param schema - Zod schema to validate against
 * @param source - Where to find the data to validate ('body', 'query', 'params')
 */
export function validateRequest(schema, source = 'body') {
    return (req, res, next) => {
        let data;
        if (source === 'body') {
            data = req.body;
        }
        else if (source === 'query') {
            data = req.query;
        }
        else {
            data = req.params;
        }
        const result = schema.safeParse(data);
        if (!result.success) {
            const errors = result.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            }));
            res.status(400).json({
                error: 'Validation failed',
                details: errors,
            });
            return;
        }
        // Replace the source data with the validated and transformed data
        if (source === 'body') {
            req.body = result.data;
        }
        next();
    };
}
/**
 * Validate multiple sources at once
 */
export function validateMultiple(schemas) {
    return (req, res, next) => {
        const errors = [];
        for (const [source, schema] of Object.entries(schemas)) {
            if (schema) {
                let data;
                if (source === 'body') {
                    data = req.body;
                }
                else if (source === 'query') {
                    data = req.query;
                }
                else {
                    data = req.params;
                }
                const result = schema.safeParse(data);
                if (!result.success) {
                    result.error.issues.forEach((issue) => {
                        errors.push({
                            source,
                            field: issue.path.join('.'),
                            message: issue.message,
                        });
                    });
                }
                else if (source === 'body') {
                    req.body = result.data;
                }
            }
        }
        if (errors.length > 0) {
            res.status(400).json({
                error: 'Validation failed',
                details: errors,
            });
            return;
        }
        next();
    };
}
