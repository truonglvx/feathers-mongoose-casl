'use strict';
// We Copy this from https://github.com/yolopunk/joi2json
// to Convert Joi schema to JSON schema;
// We added schema.properties[property.key].meta = property.schema._meta
// to keep the meth that includes ref data
const assert = require('assert');

// Converter helpers for Joi types.

let TYPES = {

  alternatives: (schema, joi) => {
    var result = schema.oneOf = [];

    joi._inner.matches.forEach(function (match) {
      if (match.schema) {
        return result.push(convert(match.schema));
      }

      if (!match.is) {
        throw new Error('joi.when requires an "is"');
      }
      if (!(match.then || match.otherwise)) {
        throw new Error('joi.when requires one or both of "then" and "otherwise"');
      }

      if (match.then) {
        result.push(convert(match.then));
      }

      if (match.otherwise) {
        result.push(convert(match.otherwise));
      }
    });
    return schema;
  },

  date: (schema, joi) => {
    if (joi._flags.timestamp) {
      schema.type = 'integer';
      return schema;
    }

    schema.type = 'string';
    schema.format = 'date-time';
    return schema;
  },

  any: (schema) => {
    schema.type = [
      'array',
      'boolean',
      'number',
      'object',
      'string',
      'null'
    ];
    return schema;
  },

  array: (schema, joi) => {
    schema.type = 'array';

    joi._tests.forEach((test) => {
      switch (test.name) {
      case 'unique':
        schema.uniqueItems = true;
        break;
      case 'length':
        schema.minItems = schema.maxItems = test.arg;
        break;
      case 'min':
        schema.minItems = test.arg;
        break;
      case 'max':
        schema.maxItems = test.arg;
        break;
      }
    });

    if (joi._inner) {
      if (joi._inner.ordereds.length) {
        schema.ordered = joi._inner.ordereds.map((item) => convert(item));
      }

      let list;
      if (joi._inner.inclusions.length) {
        list = joi._inner.inclusions;
      } else if (joi._inner.requireds.length) {
        list = joi._inner.requireds;
      }

      if (list) {
        schema.items = convert(list[0]);
        schema.items.meta = list[0]._meta;
      }
    }

    return schema;
  },

  boolean: (schema) => {
    schema.type = 'boolean';
    return schema;
  },

  number: (schema, joi) => {
    schema.type = 'number';
    joi._tests.forEach((test) => {
      switch (test.name) {
      case 'integer':
        schema.type = 'integer';
        break;
      case 'less':
        schema.exclusiveMaximum = true;
        schema.maximum = test.arg;
        break;
      case 'greater':
        schema.exclusiveMinimum = true;
        schema.minimum = test.arg;
        break;
      case 'min':
        schema.minimum = test.arg;
        break;
      case 'max':
        schema.maximum = test.arg;
        break;
      }
    });
    return schema;
  },

  string: (schema, joi) => {
    schema.type = 'string';

    joi._tests.forEach((test) => {
      switch (test.name) {
      case 'email':
        schema.format = 'email';
        break;
      case 'regex':
        // for backward compatibility
        // eslint-disable-next-line no-case-declarations
        const arg = test.arg;

        // This is required for backward compatibility
        // Location "pattern" had changed since Joi v9.0.0
        //
        // For example:
        //
        // before Joi v9: test.arg
        // since Joi v9: test.arg.pattern

        // eslint-disable-next-line no-case-declarations
        const pattern = arg && arg.pattern ? arg.pattern : arg;
        schema.pattern = String(pattern).replace(/^\//, '').replace(/\/$/, '');
        break;
      case 'min':
        schema.minLength = test.arg;
        break;
      case 'max':
        schema.maxLength = test.arg;
        break;
      case 'length':
        schema.minLength = schema.maxLength = test.arg;
        break;
      case 'uri':
        schema.format = 'uri';
        break;
      }
    });

    return schema;
  },

  object: (schema, joi) => {
    schema.type = 'object';
    schema.properties = {};
    schema.additionalProperties = Boolean(joi._flags.allowUnknown);
    schema.patterns = joi._inner.patterns.map((pattern) => {

      return {regex: pattern.regex, rule: convert(pattern.rule)};
    });

    if (!joi._inner.children) {
      return schema;
    }

    joi._inner.children.forEach((property) => {
      if (property.schema._flags.presence !== 'forbidden') {
        schema.properties[property.key] = convert(property.schema);
        schema.properties[property.key].meta = property.schema._meta;
        if (property.schema._flags.presence === 'required') {
          schema.required = schema.required || [];
          schema.required.push(property.key);
        }
      }
    });

    return schema;
  }
};

/**
 * Converts the supplied joi validation object into a JSON schema object,
 * optionally applying a transformation.
 *
 * @param {JoiValidation} joi
 * @param {TransformFunction} [transformer=null]
 * @returns {JSONSchema}
 */
function convert (joi, transformer = null) {

  assert(typeof joi === 'object' && joi.isJoi === true, 'requires a joi schema object');

  assert(joi._type, 'joi schema object must have a type');

  if (!TYPES[joi._type]) {
    throw new Error(`sorry, do not know how to convert unknown joi type: "${joi._type}"`);
  }

  if (transformer) {
    assert(typeof transformer === 'function', 'transformer must be a function');
  }

  // JSON Schema root for this type.
  let schema = {};

  // Copy over the details that all schemas may have...
  if (joi._description) {
    schema.description = joi._description;
  }

  if (joi._examples && joi._examples.length > 0) {
    schema.examples = joi._examples;
  }

  if (joi._examples && joi._examples.length === 1) {
    schema.example = joi._examples[0];
  }

  // Add the label as a title if it exists
  if (joi._settings && joi._settings.language && joi._settings.language.label) {
    schema.title = joi._settings.language.label;
  } else if (joi._flags && joi._flags.label) {
    schema.title = joi._flags.label;
  }

  // Checking for undefined and null explicitly to allow false and 0 values
  if (joi._flags && joi._flags.default !== undefined && joi._flags.default !== null) {
    schema['default'] = joi._flags.default;
  }
  if (joi._valids && joi._valids._set && joi._valids._set.size && joi._flags.allowOnly) {
    if (Array.isArray(joi._inner.children)) {
      return {
        '------oneOf': [
          {
            'type': joi._type,
            'enum': joi._valids._set
          },
          TYPES[joi._type](schema, joi)
        ]
      };
    }
    schema['enum'] = Array.from(joi._valids._set);
  }

  let result = TYPES[joi._type](schema, joi);

  if (transformer) {
    result = transformer(result);
  }

  return result;
}

module.exports = convert;

/**
 * Joi Validation Object
 * @typedef {object} JoiValidation
 */

/**
 * Transformation Function - applied just before `convert()` returns and called as `function(object):object`
 * @typedef {function} TransformFunction
 */

/**
 * JSON Schema Object
 * @typedef {object} JSONSchema
 */


// const Joi = require('joi');

// const p = convert(
//   Joi.object(
//     {
//   name: Joi.object({
//     user:  Joi.string().meta({ type: 'ObjectId', ref: 'users', displayKey: 'email' }),
//     rules:  Joi.array().items(Joi.string().meta({ type: 'ObjectId', ref: 'users', displayKey: 'name'})),
//     blockAll: Joi.boolean()
//   })
//   }
// ))
// console.log({p: p.properties.name.properties})