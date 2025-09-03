import { createSchema, createYoga } from "graphql-yoga";
import fs from 'node:fs';
import path from 'node:path';
import { Parser, compileType, getTypeName, FieldType, Options, ParserField } from 'graphql-js-tree';
import { createServer } from 'http';

const tempMemory:Record<string, any[]> = {};

const transformSchema = (schema:string) => {
    const tree = Parser.parse(schema);
    const modelTypes = tree.nodes.filter((node) => node.directives.find((directive) => directive.name === 'model'));
    const inputs = createModelInputs(modelTypes);
    return `
${schema}
${inputs}

type Query {
    ${modelTypes
        .map((model_type) => `list${model_type.name}s: [${model_type.name}!]!`)
        .join("\n    ")
    }
}

type Mutation {
    ${modelTypes
        .map((model_type) => `create${model_type.name}(${model_type.name}: ${model_type.name}Create!): ${model_type.name}`)
        .join("\n    ")
    }
    ${modelTypes
        .map((model_type) => `update${model_type.name}(id: ID!, ${model_type.name}: ${model_type.name}Update!): ${model_type.name}`)
        .join("\n    ")
    }
    ${modelTypes
        .map((model_type) => `delete${model_type.name}(id: ID!): Boolean`)
        .join("\n    ")
    }
}

${modelTypes
    .map((model_type) => `extend type ${model_type.name} { id: ID! }`)
    .join("\n")
}`
};

const createModelInputs = (nodes: ParserField[]) => {
    const scalars = ['String', 'Int', 'Float', 'Boolean', 'ID'];
    return nodes
        .map((model_type) => {
            const args = model_type
                .args
                .map((arg) => {
                    const isScalar = !!scalars.includes(getTypeName(arg.type.fieldType));
                    if (!isScalar) {
                        replaceTypeWithString(arg.type.fieldType)
                    }
                    const compiledType = compileType(arg.type.fieldType);
                    return `${arg.name}: ${compiledType}`;
                })
                .join("\n    ");
            const updateArgs = model_type
                .args
                .map((arg) => {
                    if (arg.type.fieldType.type === Options.required) {
                        arg.type.fieldType = arg.type.fieldType.nest;
                    }
                    const isScalar = !!scalars.includes(getTypeName(arg.type.fieldType));
                    if (!isScalar) {
                        replaceTypeWithString(arg.type.fieldType)
                    }
                    const compiledType = compileType(arg.type.fieldType);
                    return `${arg.name}: ${compiledType}`;
                })
                .join("\n    ");
            return `
input ${model_type.name}Create {
    ${args}
}
input ${model_type.name}Update {
    ${updateArgs}
 }`
        })
};

const replaceTypeWithString = (field: FieldType) => {
    if (field.type == Options.name) {
        field.name = "String"
    } else {
        replaceTypeWithString(field.nest)
    }
};

const schemaFromFile = fs.readFileSync(path.join(process.cwd(), './schema.graphql'), { encoding: 'utf-8' });
const transformedSchema = transformSchema(schemaFromFile);
console.log("transformedSchema")
console.log(transformedSchema);

const connectionFunction = (fromField: ParserField) => {
    return [
        fromField.name,
        (source: any) => {
            const relatedObjectFieldName = fromField
                .directives
                .find((directive) => directive.name === 'connection')
                ?.args
                .find((directiveArgument) => directiveArgument.name === 'fromField')
                ?.value
                ?.value;

            const argTypeName = getTypeName(fromField.type.fieldType);
            const isArrayField =
                fromField.type.fieldType.type === Options.array
                || (
                    fromField.type.fieldType.type === Options.required
                    && fromField.type.fieldType.nest.type === Options.array
                );
            if (relatedObjectFieldName) {
                if (isArrayField) {
                    return tempMemory[argTypeName]
                        .filter((item) => {
                            const fieldInRelatedObject = item[relatedObjectFieldName];
                            if (Array.isArray(fieldInRelatedObject)) {
                                return fieldInRelatedObject.includes(source.id)
                            } else {
                                return fieldInRelatedObject === source.id
                            }
                        })
                } else {
                    return tempMemory[argTypeName]
                        .find((item) => {
                            const fieldInRelatedObject = item[relatedObjectFieldName];
                            if (Array.isArray(fieldInRelatedObject)) {
                                return fieldInRelatedObject.includes(source.id)
                            } else {
                                return fieldInRelatedObject === source.id
                            }
                        })
                }
            }
            if (isArrayField) {
                return tempMemory[argTypeName]
                    .filter((item) => source[fromField.name].includes(item.id))
            } else {
                return tempMemory[argTypeName][source[fromField.name]]
            }
        },
    ] as const
};

const relations = Object.fromEntries(
);