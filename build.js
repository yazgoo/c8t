(function(undefined) {
  // The Opal object that is exposed globally
  var Opal = this.Opal = {};

  // The actual class for BasicObject
  var RubyBasicObject;

  // The actual Object class
  var RubyObject;

  // The actual Module class
  var RubyModule;

  // The actual Class class
  var RubyClass;

  // Constructor for instances of BasicObject
  function BasicObject(){}

  // Constructor for instances of Object
  function Object(){}

  // Constructor for instances of Class
  function Class(){}

  // Constructor for instances of Module
  function Module(){}

  // Constructor for instances of NilClass (nil)
  function NilClass(){}

  // All bridged classes - keep track to donate methods from Object
  var bridged_classes = [];

  // TopScope is used for inheriting constants from the top scope
  var TopScope = function(){};

  // Opal just acts as the top scope
  TopScope.prototype = Opal;

  // To inherit scopes
  Opal.constructor  = TopScope;

  Opal.constants = [];

  // This is a useful reference to global object inside ruby files
  Opal.global = this;

  // Minify common function calls
  var $hasOwn = Opal.hasOwnProperty;
  var $slice  = Opal.slice = Array.prototype.slice;

  // Generates unique id for every ruby object
  var unique_id = 0;

  // Return next unique id
  Opal.uid = function() {
    return unique_id++;
  };

  // Table holds all class variables
  Opal.cvars = {};

  // Globals table
  Opal.gvars = {};

  /*
   * Create a new constants scope for the given class with the given
   * base. Constants are looked up through their parents, so the base
   * scope will be the outer scope of the new klass.
   */
  function create_scope(base, klass, id) {
    var const_alloc   = function() {};
    var const_scope   = const_alloc.prototype = new base.constructor();
    klass._scope      = const_scope;
    const_scope.base  = klass;
    klass._base_module = base.base;
    const_scope.constructor = const_alloc;
    const_scope.constants = [];

    if (id) {
      klass._orig_scope = base;
      base[id] = base.constructor[id] = klass;
      base.constants.push(id);
    }
  }

  Opal.create_scope = create_scope;

  /*
   * A `class Foo; end` expression in ruby is compiled to call this runtime
   * method which either returns an existing class of the given name, or creates
   * a new class in the given `base` scope.
   *
   * If a constant with the given name exists, then we check to make sure that
   * it is a class and also that the superclasses match. If either of these
   * fail, then we raise a `TypeError`. Note, superklass may be null if one was
   * not specified in the ruby code.
   *
   * We pass a constructor to this method of the form `function ClassName() {}`
   * simply so that classes show up with nicely formatted names inside debuggers
   * in the web browser (or node/sprockets).
   *
   * The `base` is the current `self` value where the class is being created
   * from. We use this to get the scope for where the class should be created.
   * If `base` is an object (not a class/module), we simple get its class and
   * use that as the base instead.
   *
   * @param [Object] base where the class is being created
   * @param [Class] superklass superclass of the new class (may be null)
   * @param [String] id the name of the class to be created
   * @param [Function] constructor function to use as constructor
   * @return [Class] new or existing ruby class
   */
  Opal.klass = function(base, superklass, id, constructor) {

    // If base is an object, use its class
    if (!base._isClass) {
      base = base._klass;
    }

    // Not specifying a superclass means we can assume it to be Object
    if (superklass === null) {
      superklass = RubyObject;
    }

    var klass = base._scope[id];

    // If a constant exists in the scope, then we must use that
    if ($hasOwn.call(base._scope, id) && klass._orig_scope === base._scope) {

      // Make sure the existing constant is a class, or raise error
      if (!klass._isClass) {
        throw Opal.TypeError.$new(id + " is not a class");
      }

      // Make sure existing class has same superclass
      if (superklass !== klass._super && superklass !== RubyObject) {
        throw Opal.TypeError.$new("superclass mismatch for class " + id);
      }
    }
    else if (typeof(superklass) === 'function') {
      // passed native constructor as superklass, so bridge it as ruby class
      return bridge_class(id, superklass);
    }
    else {
      // if class doesnt exist, create a new one with given superclass
      klass = boot_class(superklass, constructor);

      // name class using base (e.g. Foo or Foo::Baz)
      klass._name = id;

      // every class gets its own constant scope, inherited from current scope
      create_scope(base._scope, klass, id);

      // Name new class directly onto current scope (Opal.Foo.Baz = klass)
      base[id] = base._scope[id] = klass;

      // Copy all parent constants to child, unless parent is Object
      if (superklass !== RubyObject && superklass !== RubyBasicObject) {
        Opal.donate_constants(superklass, klass);
      }

      // call .inherited() hook with new class on the superclass
      if (superklass.$inherited) {
        superklass.$inherited(klass);
      }
    }

    return klass;
  };

  // Create generic class with given superclass.
  var boot_class = Opal.boot = function(superklass, constructor) {
    // instances
    var ctor = function() {};
        ctor.prototype = superklass._proto;

    constructor.prototype = new ctor();

    constructor.prototype.constructor = constructor;

    return boot_class_meta(superklass, constructor);
  };

  // class itself
  function boot_class_meta(superklass, constructor) {
    var mtor = function() {};
    mtor.prototype = superklass.constructor.prototype;

    function OpalClass() {};
    OpalClass.prototype = new mtor();

    var klass = new OpalClass();

    klass._id         = unique_id++;
    klass._alloc      = constructor;
    klass._isClass    = true;
    klass.constructor = OpalClass;
    klass._super      = superklass;
    klass._methods    = [];
    klass.__inc__     = [];
    klass.__parent    = superklass;
    klass._proto      = constructor.prototype;

    constructor.prototype._klass = klass;

    return klass;
  }

  // Define new module (or return existing module)
  Opal.module = function(base, id) {
    var module;

    if (!base._isClass) {
      base = base._klass;
    }

    if ($hasOwn.call(base._scope, id)) {
      module = base._scope[id];

      if (!module.__mod__ && module !== RubyObject) {
        throw Opal.TypeError.$new(id + " is not a module")
      }
    }
    else {
      module = boot_module()
      module._name = id;

      create_scope(base._scope, module, id);

      // Name new module directly onto current scope (Opal.Foo.Baz = module)
      base[id] = base._scope[id] = module;
    }

    return module;
  };

  /*
   * Internal function to create a new module instance. This simply sets up
   * the prototype hierarchy and method tables.
   */
  function boot_module() {
    var mtor = function() {};
    mtor.prototype = RubyModule.constructor.prototype;

    function OpalModule() {};
    OpalModule.prototype = new mtor();

    var module = new OpalModule();

    module._id         = unique_id++;
    module._isClass    = true;
    module.constructor = OpalModule;
    module._super      = RubyModule;
    module._methods    = [];
    module.__inc__     = [];
    module.__parent    = RubyModule;
    module._proto      = {};
    module.__mod__     = true;
    module.__dep__     = [];

    return module;
  }

  // Boot a base class (makes instances).
  var boot_defclass = function(id, constructor, superklass) {
    if (superklass) {
      var ctor           = function() {};
          ctor.prototype = superklass.prototype;

      constructor.prototype = new ctor();
    }

    constructor.prototype.constructor = constructor;

    return constructor;
  };

  // Boot the actual (meta?) classes of core classes
  var boot_makemeta = function(id, constructor, superklass) {

    var mtor = function() {};
    mtor.prototype  = superklass.prototype;

    function OpalClass() {};
    OpalClass.prototype = new mtor();

    var klass = new OpalClass();

    klass._id         = unique_id++;
    klass._alloc      = constructor;
    klass._isClass    = true;
    klass._name       = id;
    klass._super      = superklass;
    klass.constructor = OpalClass;
    klass._methods    = [];
    klass.__inc__     = [];
    klass.__parent    = superklass;
    klass._proto      = constructor.prototype;

    constructor.prototype._klass = klass;

    Opal[id] = klass;
    Opal.constants.push(id);

    return klass;
  };

  /*
   * For performance, some core ruby classes are toll-free bridged to their
   * native javascript counterparts (e.g. a ruby Array is a javascript Array).
   *
   * This method is used to setup a native constructor (e.g. Array), to have
   * its prototype act like a normal ruby class. Firstly, a new ruby class is
   * created using the native constructor so that its prototype is set as the
   * target for th new class. Note: all bridged classes are set to inherit
   * from Object.
   *
   * Bridged classes are tracked in `bridged_classes` array so that methods
   * defined on Object can be "donated" to all bridged classes. This allows
   * us to fake the inheritance of a native prototype from our Object
   * prototype.
   *
   * Example:
   *
   *    bridge_class("Proc", Function);
   *
   * @param [String] name the name of the ruby class to create
   * @param [Function] constructor native javascript constructor to use
   * @return [Class] returns new ruby class
   */
  function bridge_class(name, constructor) {
    var klass = boot_class_meta(RubyObject, constructor);

    klass._name = name;

    create_scope(Opal, klass, name);
    bridged_classes.push(klass);

    var object_methods = RubyBasicObject._methods.concat(RubyObject._methods);

    for (var i = 0, len = object_methods.length; i < len; i++) {
      var meth = object_methods[i];
      constructor.prototype[meth] = RubyObject._proto[meth];
    }

    return klass;
  };

  /*
   * constant assign
   */
  Opal.casgn = function(base_module, name, value) {
    var scope = base_module._scope;

    if (value._isClass && value._name === nil) {
      value._name = name;
    }

    if (value._isClass) {
      value._base_module = base_module;
    }

    scope.constants.push(name);
    return scope[name] = value;
  };

  /*
   * constant decl
   */
  Opal.cdecl = function(base_scope, name, value) {
    base_scope.constants.push(name);
    return base_scope[name] = value;
  };

  /*
   * constant get
   */
  Opal.cget = function(base_scope, path) {
    if (path == null) {
      path       = base_scope;
      base_scope = Opal.Object;
    }

    var result = base_scope;

    path = path.split('::');
    while (path.length != 0) {
      result = result.$const_get(path.shift());
    }

    return result;
  }

  /*
   * When a source module is included into the target module, we must also copy
   * its constants to the target.
   */
  Opal.donate_constants = function(source_mod, target_mod) {
    var source_constants = source_mod._scope.constants,
        target_scope     = target_mod._scope,
        target_constants = target_scope.constants;

    for (var i = 0, length = source_constants.length; i < length; i++) {
      target_constants.push(source_constants[i]);
      target_scope[source_constants[i]] = source_mod._scope[source_constants[i]];
    }
  };

  /*
   * Methods stubs are used to facilitate method_missing in opal. A stub is a
   * placeholder function which just calls `method_missing` on the receiver.
   * If no method with the given name is actually defined on an object, then it
   * is obvious to say that the stub will be called instead, and then in turn
   * method_missing will be called.
   *
   * When a file in ruby gets compiled to javascript, it includes a call to
   * this function which adds stubs for every method name in the compiled file.
   * It should then be safe to assume that method_missing will work for any
   * method call detected.
   *
   * Method stubs are added to the BasicObject prototype, which every other
   * ruby object inherits, so all objects should handle method missing. A stub
   * is only added if the given property name (method name) is not already
   * defined.
   *
   * Note: all ruby methods have a `$` prefix in javascript, so all stubs will
   * have this prefix as well (to make this method more performant).
   *
   *    Opal.add_stubs(["$foo", "$bar", "$baz="]);
   *
   * All stub functions will have a private `rb_stub` property set to true so
   * that other internal methods can detect if a method is just a stub or not.
   * `Kernel#respond_to?` uses this property to detect a methods presence.
   *
   * @param [Array] stubs an array of method stubs to add
   */
  Opal.add_stubs = function(stubs) {
    for (var i = 0, length = stubs.length; i < length; i++) {
      var stub = stubs[i];

      if (!BasicObject.prototype[stub]) {
        BasicObject.prototype[stub] = true;
        add_stub_for(BasicObject.prototype, stub);
      }
    }
  };

  /*
   * Actuall add a method_missing stub function to the given prototype for the
   * given name.
   *
   * @param [Prototype] prototype the target prototype
   * @param [String] stub stub name to add (e.g. "$foo")
   */
  function add_stub_for(prototype, stub) {
    function method_missing_stub() {
      // Copy any given block onto the method_missing dispatcher
      this.$method_missing._p = method_missing_stub._p;

      // Set block property to null ready for the next call (stop false-positives)
      method_missing_stub._p = null;

      // call method missing with correct args (remove '$' prefix on method name)
      return this.$method_missing.apply(this, [stub.slice(1)].concat($slice.call(arguments)));
    }

    method_missing_stub.rb_stub = true;
    prototype[stub] = method_missing_stub;
  }

  // Expose for other parts of Opal to use
  Opal.add_stub_for = add_stub_for;

  // Const missing dispatcher
  Opal.cm = function(name) {
    return this.base.$const_missing(name);
  };

  // Arity count error dispatcher
  Opal.ac = function(actual, expected, object, meth) {
    var inspect = (object._isClass ? object._name + '.' : object._klass._name + '#') + meth;
    var msg = '[' + inspect + '] wrong number of arguments(' + actual + ' for ' + expected + ')';
    throw Opal.ArgumentError.$new(msg);
  };

  // Super dispatcher
  Opal.find_super_dispatcher = function(obj, jsid, current_func, iter, defs) {
    var dispatcher;

    if (defs) {
      dispatcher = obj._isClass ? defs._super : obj._klass._proto;
    }
    else {
      if (obj._isClass) {
        dispatcher = obj._super;
      }
      else {
        dispatcher = find_obj_super_dispatcher(obj, jsid, current_func);
      }
    }

    dispatcher = dispatcher['$' + jsid];
    dispatcher._p = iter;

    return dispatcher;
  };

  // Iter dispatcher for super in a block
  Opal.find_iter_super_dispatcher = function(obj, jsid, current_func, iter, defs) {
    if (current_func._def) {
      return Opal.find_super_dispatcher(obj, current_func._jsid, current_func, iter, defs);
    }
    else {
      return Opal.find_super_dispatcher(obj, jsid, current_func, iter, defs);
    }
  };

  var find_obj_super_dispatcher = function(obj, jsid, current_func) {
    var klass = obj.__meta__ || obj._klass;

    while (klass) {
      if (klass._proto['$' + jsid] === current_func) {
        // ok
        break;
      }

      klass = klass.__parent;
    }

    // if we arent in a class, we couldnt find current?
    if (!klass) {
      throw new Error("could not find current class for super()");
    }

    klass = klass.__parent;

    // else, let's find the next one
    while (klass) {
      var working = klass._proto['$' + jsid];

      if (working && working !== current_func) {
        // ok
        break;
      }

      klass = klass.__parent;
    }

    return klass._proto;
  };

  /*
   * Used to return as an expression. Sometimes, we can't simply return from
   * a javascript function as if we were a method, as the return is used as
   * an expression, or even inside a block which must "return" to the outer
   * method. This helper simply throws an error which is then caught by the
   * method. This approach is expensive, so it is only used when absolutely
   * needed.
   */
  Opal.$return = function(val) {
    Opal.returner.$v = val;
    throw Opal.returner;
  };

  // handles yield calls for 1 yielded arg
  Opal.$yield1 = function(block, arg) {
    if (typeof(block) !== "function") {
      throw Opal.LocalJumpError.$new("no block given");
    }

    if (block.length > 1) {
      if (arg._isArray) {
        return block.apply(null, arg);
      }
      else {
        return block(arg);
      }
    }
    else {
      return block(arg);
    }
  };

  // handles yield for > 1 yielded arg
  Opal.$yieldX = function(block, args) {
    if (typeof(block) !== "function") {
      throw Opal.LocalJumpError.$new("no block given");
    }

    if (block.length > 1 && args.length == 1) {
      if (args[0]._isArray) {
        return block.apply(null, args[0]);
      }
    }

    if (!args._isArray) {
      args = $slice.call(args);
    }

    return block.apply(null, args);
  };

  Opal.is_a = function(object, klass) {
    if (object.__meta__ === klass) {
      return true;
    }

    var search = object._klass;

    while (search) {
      if (search === klass) {
        return true;
      }

      search = search._super;
    }

    return false;
  }

  // Helper to convert the given object to an array
  Opal.to_ary = function(value) {
    if (value._isArray) {
      return value;
    }
    else if (value.$to_ary && !value.$to_ary.rb_stub) {
      return value.$to_ary();
    }

    return [value];
  };

  /*
    Call a ruby method on a ruby object with some arguments:

      var my_array = [1, 2, 3, 4]
      Opal.send(my_array, 'length')     # => 4
      Opal.send(my_array, 'reverse!')   # => [4, 3, 2, 1]

    A missing method will be forwarded to the object via
    method_missing.

    The result of either call with be returned.

    @param [Object] recv the ruby object
    @param [String] mid ruby method to call
  */
  Opal.send = function(recv, mid) {
    var args = $slice.call(arguments, 2),
        func = recv['$' + mid];

    if (func) {
      return func.apply(recv, args);
    }

    return recv.$method_missing.apply(recv, [mid].concat(args));
  };

  Opal.block_send = function(recv, mid, block) {
    var args = $slice.call(arguments, 3),
        func = recv['$' + mid];

    if (func) {
      func._p = block;
      return func.apply(recv, args);
    }

    return recv.$method_missing.apply(recv, [mid].concat(args));
  };

  /**
   * Donate methods for a class/module
   */
  Opal.donate = function(klass, defined, indirect) {
    var methods = klass._methods, included_in = klass.__dep__;

    // if (!indirect) {
      klass._methods = methods.concat(defined);
    // }

    if (included_in) {
      for (var i = 0, length = included_in.length; i < length; i++) {
        var includee = included_in[i];
        var dest = includee._proto;

        for (var j = 0, jj = defined.length; j < jj; j++) {
          var method = defined[j];
          dest[method] = klass._proto[method];
          dest[method]._donated = true;
        }

        if (includee.__dep__) {
          Opal.donate(includee, defined, true);
        }
      }
    }
  };

  Opal.defn = function(obj, jsid, body) {
    if (obj.__mod__) {
      obj._proto[jsid] = body;
      Opal.donate(obj, [jsid]);
    }
    else if (obj._isClass) {
      obj._proto[jsid] = body;

      if (obj === RubyBasicObject) {
        define_basic_object_method(jsid, body);
      }
      else if (obj === RubyObject) {
        Opal.donate(obj, [jsid]);
      }
    }
    else {
      obj[jsid] = body;
    }

    return nil;
  };

  /*
   * Define a singleton method on the given object.
   */
  Opal.defs = function(obj, jsid, body) {
    if (obj._isClass || obj.__mod__) {
      obj.constructor.prototype[jsid] = body;
    }
    else {
      obj[jsid] = body;
    }
  };

  function define_basic_object_method(jsid, body) {
    RubyBasicObject._methods.push(jsid);
    for (var i = 0, len = bridged_classes.length; i < len; i++) {
      bridged_classes[i]._proto[jsid] = body;
    }
  }

  Opal.hash = function() {
    if (arguments.length == 1 && arguments[0]._klass == Opal.Hash) {
      return arguments[0];
    }

    var hash   = new Opal.Hash._alloc,
        keys   = [],
        assocs = {};

    hash.map   = assocs;
    hash.keys  = keys;

    if (arguments.length == 1 && arguments[0]._isArray) {
      var args = arguments[0];

      for (var i = 0, length = args.length; i < length; i++) {
        var key = args[i][0], obj = args[i][1];

        if (assocs[key] == null) {
          keys.push(key);
        }

        assocs[key] = obj;
      }
    }
    else {
      for (var i = 0, length = arguments.length; i < length; i++) {
        var key = arguments[i],
            obj = arguments[++i];

        if (assocs[key] == null) {
          keys.push(key);
        }

        assocs[key] = obj;
      }
    }

    return hash;
  };

  /*
   * hash2 is a faster creator for hashes that just use symbols and
   * strings as keys. The map and keys array can be constructed at
   * compile time, so they are just added here by the constructor
   * function
   */
  Opal.hash2 = function(keys, map) {
    var hash = new Opal.Hash._alloc;

    hash.keys = keys;
    hash.map  = map;

    return hash;
  };

  /*
   * Create a new range instance with first and last values, and whether the
   * range excludes the last value.
   */
  Opal.range = function(first, last, exc) {
    var range         = new Opal.Range._alloc;
        range.begin   = first;
        range.end     = last;
        range.exclude = exc;

    return range;
  };

  // Initialization
  // --------------

  // Constructors for *instances* of core objects
  boot_defclass('BasicObject', BasicObject);
  boot_defclass('Object', Object, BasicObject);
  boot_defclass('Module', Module, Object);
  boot_defclass('Class', Class, Module);

  // Constructors for *classes* of core objects
  RubyBasicObject = boot_makemeta('BasicObject', BasicObject, Class);
  RubyObject      = boot_makemeta('Object', Object, RubyBasicObject.constructor);
  RubyModule      = boot_makemeta('Module', Module, RubyObject.constructor);
  RubyClass       = boot_makemeta('Class', Class, RubyModule.constructor);

  // Fix booted classes to use their metaclass
  RubyBasicObject._klass = RubyClass;
  RubyObject._klass = RubyClass;
  RubyModule._klass = RubyClass;
  RubyClass._klass = RubyClass;

  // Fix superclasses of booted classes
  RubyBasicObject._super = null;
  RubyObject._super = RubyBasicObject;
  RubyModule._super = RubyObject;
  RubyClass._super = RubyModule;

  // Internally, Object acts like a module as it is "included" into bridged
  // classes. In other words, we donate methods from Object into our bridged
  // classes as their prototypes don't inherit from our root Object, so they
  // act like module includes.
  RubyObject.__dep__ = bridged_classes;

  Opal.base = RubyObject;
  RubyBasicObject._scope = RubyObject._scope = Opal;
  RubyBasicObject._orig_scope = RubyObject._orig_scope = Opal;
  Opal.Kernel = RubyObject;

  RubyModule._scope = RubyObject._scope;
  RubyClass._scope = RubyObject._scope;
  RubyModule._orig_scope = RubyObject._orig_scope;
  RubyClass._orig_scope = RubyObject._orig_scope;

  RubyObject._proto.toString = function() {
    return this.$to_s();
  };

  Opal.top = new RubyObject._alloc();

  Opal.klass(RubyObject, RubyObject, 'NilClass', NilClass);

  var nil = Opal.nil = new NilClass;
  nil.call = nil.apply = function() { throw Opal.LocalJumpError.$new('no block given'); };

  Opal.breaker  = new Error('unexpected break');
  Opal.returner = new Error('unexpected return');

  bridge_class('Array', Array);
  bridge_class('Boolean', Boolean);
  bridge_class('Numeric', Number);
  bridge_class('String', String);
  bridge_class('Proc', Function);
  bridge_class('Exception', Error);
  bridge_class('Regexp', RegExp);
  bridge_class('Time', Date);

  TypeError._super = Error;
}).call(this);
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module;
  $opal.add_stubs(['$===', '$respond_to?', '$raise', '$class', '$__send__', '$coerce_to', '$<=>', '$name']);
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self._proto, $scope = self._scope;
    $opal.defs(self, '$coerce_to', function(object, type, method) {
      var $a, self = this;
      if (($a = type['$==='](object)) !== false && $a !== nil) {
        return object};
      if (($a = object['$respond_to?'](method)) === false || $a === nil) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "no implicit conversion of " + (object.$class()) + " into " + (type))};
      return object.$__send__(method);
    });

    $opal.defs(self, '$coerce_to!', function(object, type, method) {
      var $a, self = this, coerced = nil;
      coerced = self.$coerce_to(object, type, method);
      if (($a = type['$==='](coerced)) === false || $a === nil) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "can't convert " + (object.$class()) + " into " + (type) + " (" + (object.$class()) + "#" + (method) + " gives " + (coerced.$class()))};
      return coerced;
    });

    $opal.defs(self, '$try_convert', function(object, type, method) {
      var $a, self = this;
      if (($a = type['$==='](object)) !== false && $a !== nil) {
        return object};
      if (($a = object['$respond_to?'](method)) !== false && $a !== nil) {
        return object.$__send__(method)
        } else {
        return nil
      };
    });

    $opal.defs(self, '$compare', function(a, b) {
      var $a, self = this, compare = nil;
      compare = a['$<=>'](b);
      if (($a = compare === nil) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (a.$class().$name()) + " with " + (b.$class().$name()) + " failed")};
      return compare;
    });

    $opal.defs(self, '$fits_fixnum!', function(value) {
      var $a, self = this;
      if (($a = value > 2147483648) !== false && $a !== nil) {
        return self.$raise((($a = $scope.RangeError) == null ? $opal.cm('RangeError') : $a), "bignum too big to convert into `long'")
        } else {
        return nil
      };
    });

    $opal.defs(self, '$fits_array!', function(value) {
      var $a, self = this;
      if (($a = value >= 536870910) !== false && $a !== nil) {
        return self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "argument too big")
        } else {
        return nil
      };
    });

    $opal.defs(self, '$destructure', function(args) {
      var self = this;
      
      if (args.length == 1) {
        return args[0];
      }
      else if (args._isArray) {
        return args;
      }
      else {
        return $slice.call(args);
      }
    
    });
    
  })(self)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/helpers.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$attr_reader', '$attr_writer', '$=~', '$raise', '$const_missing', '$to_str', '$to_proc', '$append_features', '$included', '$name', '$new', '$to_s']);
  return (function($base, $super) {
    function $Module(){};
    var self = $Module = $klass($base, $super, 'Module', $Module);

    var def = $Module._proto, $scope = $Module._scope, TMP_1, TMP_2, TMP_3, TMP_4;
    $opal.defs(self, '$new', TMP_1 = function() {
      var self = this, $iter = TMP_1._p, block = $iter || nil;
      TMP_1._p = null;
      
      function AnonModule(){}
      var klass     = Opal.boot(Opal.Module, AnonModule);
      klass._name   = nil;
      klass._klass  = Opal.Module;
      klass.__dep__ = []
      klass.__mod__ = true;
      klass._proto  = {};

      // inherit scope from parent
      $opal.create_scope(Opal.Module._scope, klass);

      if (block !== nil) {
        var block_self = block._s;
        block._s = null;
        block.call(klass);
        block._s = block_self;
      }

      return klass;
    
    });

    def['$==='] = function(object) {
      var $a, self = this;
      if (($a = object == null) !== false && $a !== nil) {
        return false};
      return $opal.is_a(object, self);
    };

    def['$<'] = function(other) {
      var self = this;
      
      var working = self;

      while (working) {
        if (working === other) {
          return true;
        }

        working = working.__parent;
      }

      return false;
    
    };

    def.$alias_method = function(newname, oldname) {
      var self = this;
      
      self._proto['$' + newname] = self._proto['$' + oldname];

      if (self._methods) {
        $opal.donate(self, ['$' + newname ])
      }
    
      return self;
    };

    def.$alias_native = function(mid, jsid) {
      var self = this;
      if (jsid == null) {
        jsid = mid
      }
      return self._proto['$' + mid] = self._proto[jsid];
    };

    def.$ancestors = function() {
      var self = this;
      
      var parent = self,
          result = [];

      while (parent) {
        result.push(parent);
        result = result.concat(parent.__inc__);

        parent = parent._super;
      }

      return result;
    
    };

    def.$append_features = function(klass) {
      var self = this;
      
      var module   = self,
          included = klass.__inc__;

      // check if this module is already included in the klass
      for (var i = 0, length = included.length; i < length; i++) {
        if (included[i] === module) {
          return;
        }
      }

      included.push(module);
      module.__dep__.push(klass);

      // iclass
      var iclass = {
        name: module._name,

        _proto:   module._proto,
        __parent: klass.__parent,
        __iclass: true
      };

      klass.__parent = iclass;

      var donator   = module._proto,
          prototype = klass._proto,
          methods   = module._methods;

      for (var i = 0, length = methods.length; i < length; i++) {
        var method = methods[i];

        if (prototype.hasOwnProperty(method) && !prototype[method]._donated) {
          // if the target class already has a method of the same name defined
          // and that method was NOT donated, then it must be a method defined
          // by the class so we do not want to override it
        }
        else {
          prototype[method] = donator[method];
          prototype[method]._donated = true;
        }
      }

      if (klass.__dep__) {
        $opal.donate(klass, methods.slice(), true);
      }

      $opal.donate_constants(module, klass);
    
      return self;
    };

    def.$attr_accessor = function(names) {
      var $a, $b, self = this;
      names = $slice.call(arguments, 0);
      ($a = self).$attr_reader.apply($a, [].concat(names));
      return ($b = self).$attr_writer.apply($b, [].concat(names));
    };

    def.$attr_reader = function(names) {
      var self = this;
      names = $slice.call(arguments, 0);
      
      var proto = self._proto, cls = self;
      for (var i = 0, length = names.length; i < length; i++) {
        (function(name) {
          proto[name] = nil;
          var func = function() { return this[name] };

          if (cls._isSingleton) {
            proto.constructor.prototype['$' + name] = func;
          }
          else {
            proto['$' + name] = func;
            $opal.donate(self, ['$' + name ]);
          }
        })(names[i]);
      }
    ;
      return nil;
    };

    def.$attr_writer = function(names) {
      var self = this;
      names = $slice.call(arguments, 0);
      
      var proto = self._proto, cls = self;
      for (var i = 0, length = names.length; i < length; i++) {
        (function(name) {
          proto[name] = nil;
          var func = function(value) { return this[name] = value; };

          if (cls._isSingleton) {
            proto.constructor.prototype['$' + name + '='] = func;
          }
          else {
            proto['$' + name + '='] = func;
            $opal.donate(self, ['$' + name + '=']);
          }
        })(names[i]);
      }
    ;
      return nil;
    };

    $opal.defn(self, '$attr', def.$attr_accessor);

    def.$constants = function() {
      var self = this;
      return self._scope.constants;
    };

    def['$const_defined?'] = function(name, inherit) {
      var $a, self = this;
      if (inherit == null) {
        inherit = true
      }
      if (($a = name['$=~'](/^[A-Z]\w*$/)) === false || $a === nil) {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "wrong constant name " + (name))};
      
      scopes = [self._scope];
      if (inherit || self === Opal.Object) {
        var parent = self._super;
        while (parent !== Opal.BasicObject) {
          scopes.push(parent._scope);
          parent = parent._super;
        }
      }

      for (var i = 0, len = scopes.length; i < len; i++) {
        if (scopes[i].hasOwnProperty(name)) {
          return true;
        }
      }

      return false;
    ;
    };

    def.$const_get = function(name, inherit) {
      var $a, self = this;
      if (inherit == null) {
        inherit = true
      }
      if (($a = name['$=~'](/^[A-Z]\w*$/)) === false || $a === nil) {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "wrong constant name " + (name))};
      
      var scopes = [self._scope];
      if (inherit || self == Opal.Object) {
        var parent = self._super;
        while (parent !== Opal.BasicObject) {
          scopes.push(parent._scope);
          parent = parent._super;
        }
      }

      for (var i = 0, len = scopes.length; i < len; i++) {
        if (scopes[i].hasOwnProperty(name)) {
          return scopes[i][name];
        }
      }

      return self.$const_missing(name);
    ;
    };

    def.$const_missing = function(const$) {
      var $a, self = this, name = nil;
      name = self._name;
      return self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "uninitialized constant " + (name) + "::" + (const$));
    };

    def.$const_set = function(name, value) {
      var $a, self = this;
      if (($a = name['$=~'](/^[A-Z]\w*$/)) === false || $a === nil) {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "wrong constant name " + (name))};
      try {
      name = name.$to_str()
      } catch ($err) {if (true) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "conversion with #to_str failed")
        }else { throw $err; }
      };
      
      $opal.casgn(self, name, value);
      return value
    ;
    };

    def.$define_method = TMP_2 = function(name, method) {
      var self = this, $iter = TMP_2._p, block = $iter || nil;
      TMP_2._p = null;
      
      if (method) {
        block = method.$to_proc();
      }

      if (block === nil) {
        throw new Error("no block given");
      }

      var jsid    = '$' + name;
      block._jsid = name;
      block._s    = null;
      block._def  = block;

      self._proto[jsid] = block;
      $opal.donate(self, [jsid]);

      return null;
    ;
    };

    def.$remove_method = function(name) {
      var self = this;
      
      var jsid    = '$' + name;
      var current = self._proto[jsid];
      delete self._proto[jsid];

      // Check if we need to reverse $opal.donate
      // $opal.retire(self, [jsid]);
      return self;
    
    };

    def.$include = function(mods) {
      var self = this;
      mods = $slice.call(arguments, 0);
      
      var i = mods.length - 1, mod;
      while (i >= 0) {
        mod = mods[i];
        i--;

        if (mod === self) {
          continue;
        }

        (mod).$append_features(self);
        (mod).$included(self);
      }

      return self;
    
    };

    def.$instance_method = function(name) {
      var $a, self = this;
      
      var meth = self._proto['$' + name];

      if (!meth || meth.rb_stub) {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "undefined method `" + (name) + "' for class `" + (self.$name()) + "'");
      }

      return (($a = $scope.UnboundMethod) == null ? $opal.cm('UnboundMethod') : $a).$new(self, meth, name);
    
    };

    def.$instance_methods = function(include_super) {
      var self = this;
      if (include_super == null) {
        include_super = false
      }
      
      var methods = [], proto = self._proto;

      for (var prop in self._proto) {
        if (!include_super && !proto.hasOwnProperty(prop)) {
          continue;
        }

        if (!include_super && proto[prop]._donated) {
          continue;
        }

        if (prop.charAt(0) === '$') {
          methods.push(prop.substr(1));
        }
      }

      return methods;
    ;
    };

    def.$included = function(mod) {
      var self = this;
      return nil;
    };

    def.$module_eval = TMP_3 = function() {
      var self = this, $iter = TMP_3._p, block = $iter || nil;
      TMP_3._p = null;
      
      if (block === nil) {
        throw new Error("no block given");
      }

      var block_self = block._s, result;

      block._s = null;
      result = block.call(self);
      block._s = block_self;

      return result;
    
    };

    $opal.defn(self, '$class_eval', def.$module_eval);

    def.$module_exec = TMP_4 = function() {
      var self = this, $iter = TMP_4._p, block = $iter || nil;
      TMP_4._p = null;
      
      if (block === nil) {
        throw new Error("no block given");
      }

      var block_self = block._s, result;

      block._s = null;
      result = block.apply(self, $slice.call(arguments));
      block._s = block_self;

      return result;
    
    };

    $opal.defn(self, '$class_exec', def.$module_exec);

    def['$method_defined?'] = function(method) {
      var self = this;
      
      var body = self._proto['$' + method];
      return (!!body) && !body.rb_stub;
    ;
    };

    def.$module_function = function(methods) {
      var self = this;
      methods = $slice.call(arguments, 0);
      
      for (var i = 0, length = methods.length; i < length; i++) {
        var meth = methods[i], func = self._proto['$' + meth];

        self.constructor.prototype['$' + meth] = func;
      }

      return self;
    
    };

    def.$name = function() {
      var self = this;
      
      if (self._full_name) {
        return self._full_name;
      }

      var result = [], base = self;

      while (base) {
        if (base._name === nil) {
          return result.length === 0 ? nil : result.join('::');
        }

        result.unshift(base._name);

        base = base._base_module;

        if (base === $opal.Object) {
          break;
        }
      }

      if (result.length === 0) {
        return nil;
      }

      return self._full_name = result.join('::');
    
    };

    def.$public = function() {
      var self = this;
      return nil;
    };

    def.$private_class_method = function(name) {
      var self = this;
      return self['$' + name] || nil;
    };

    $opal.defn(self, '$private', def.$public);

    $opal.defn(self, '$protected', def.$public);

    def['$private_method_defined?'] = function(obj) {
      var self = this;
      return false;
    };

    $opal.defn(self, '$protected_method_defined?', def['$private_method_defined?']);

    $opal.defn(self, '$public_instance_methods', def.$instance_methods);

    $opal.defn(self, '$public_method_defined?', def['$method_defined?']);

    def.$remove_class_variable = function() {
      var self = this;
      return nil;
    };

    def.$remove_const = function(name) {
      var self = this;
      
      var old = self._scope[name];
      delete self._scope[name];
      return old;
    ;
    };

    def.$to_s = function() {
      var self = this;
      return self.$name().$to_s();
    };

    return (def.$undef_method = function(symbol) {
      var self = this;
      $opal.add_stub_for(self._proto, "$" + symbol);
      return self;
    }, nil);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/module.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$raise', '$allocate']);
  return (function($base, $super) {
    function $Class(){};
    var self = $Class = $klass($base, $super, 'Class', $Class);

    var def = $Class._proto, $scope = $Class._scope, TMP_1, TMP_2;
    $opal.defs(self, '$new', TMP_1 = function(sup) {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil;
      if (sup == null) {
        sup = (($a = $scope.Object) == null ? $opal.cm('Object') : $a)
      }
      TMP_1._p = null;
      
      if (!sup._isClass || sup.__mod__) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "superclass must be a Class");
      }

      function AnonClass(){};
      var klass       = Opal.boot(sup, AnonClass)
      klass._name     = nil;
      klass.__parent  = sup;

      // inherit scope from parent
      $opal.create_scope(sup._scope, klass);

      sup.$inherited(klass);

      if (block !== nil) {
        var block_self = block._s;
        block._s = null;
        block.call(klass);
        block._s = block_self;
      }

      return klass;
    ;
    });

    def.$allocate = function() {
      var self = this;
      
      var obj = new self._alloc;
      obj._id = Opal.uid();
      return obj;
    
    };

    def.$inherited = function(cls) {
      var self = this;
      return nil;
    };

    def.$new = TMP_2 = function(args) {
      var self = this, $iter = TMP_2._p, block = $iter || nil;
      args = $slice.call(arguments, 0);
      TMP_2._p = null;
      
      var obj = self.$allocate();

      obj.$initialize._p = block;
      obj.$initialize.apply(obj, args);
      return obj;
    ;
    };

    return (def.$superclass = function() {
      var self = this;
      return self._super || nil;
    }, nil);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/class.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$raise']);
  return (function($base, $super) {
    function $BasicObject(){};
    var self = $BasicObject = $klass($base, $super, 'BasicObject', $BasicObject);

    var def = $BasicObject._proto, $scope = $BasicObject._scope, TMP_1, TMP_2, TMP_3, TMP_4;
    $opal.defn(self, '$initialize', function() {
      var self = this;
      return nil;
    });

    $opal.defn(self, '$==', function(other) {
      var self = this;
      return self === other;
    });

    $opal.defn(self, '$__id__', function() {
      var self = this;
      return self._id || (self._id = Opal.uid());
    });

    $opal.defn(self, '$__send__', TMP_1 = function(symbol, args) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;
      args = $slice.call(arguments, 1);
      TMP_1._p = null;
      
      var func = self['$' + symbol]

      if (func) {
        if (block !== nil) {
          func._p = block;
        }

        return func.apply(self, args);
      }

      if (block !== nil) {
        self.$method_missing._p = block;
      }

      return self.$method_missing.apply(self, [symbol].concat(args));
    
    });

    $opal.defn(self, '$eql?', def['$==']);

    $opal.defn(self, '$equal?', def['$==']);

    $opal.defn(self, '$instance_eval', TMP_2 = function() {
      var $a, self = this, $iter = TMP_2._p, block = $iter || nil;
      TMP_2._p = null;
      if (($a = block) === false || $a === nil) {
        (($a = $scope.Kernel) == null ? $opal.cm('Kernel') : $a).$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "no block given")};
      
      var block_self = block._s,
          result;

      block._s = null;
      result = block.call(self, self);
      block._s = block_self;

      return result;
    
    });

    $opal.defn(self, '$instance_exec', TMP_3 = function(args) {
      var $a, self = this, $iter = TMP_3._p, block = $iter || nil;
      args = $slice.call(arguments, 0);
      TMP_3._p = null;
      if (($a = block) === false || $a === nil) {
        (($a = $scope.Kernel) == null ? $opal.cm('Kernel') : $a).$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "no block given")};
      
      var block_self = block._s,
          result;

      block._s = null;
      result = block.apply(self, args);
      block._s = block_self;

      return result;
    
    });

    return ($opal.defn(self, '$method_missing', TMP_4 = function(symbol, args) {
      var $a, self = this, $iter = TMP_4._p, block = $iter || nil;
      args = $slice.call(arguments, 1);
      TMP_4._p = null;
      return (($a = $scope.Kernel) == null ? $opal.cm('Kernel') : $a).$raise((($a = $scope.NoMethodError) == null ? $opal.cm('NoMethodError') : $a), "undefined method `" + (symbol) + "' for BasicObject instance");
    }), nil);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/basic_object.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module, $gvars = $opal.gvars;
  $opal.add_stubs(['$raise', '$inspect', '$==', '$name', '$class', '$new', '$respond_to?', '$to_ary', '$to_a', '$allocate', '$copy_instance_variables', '$initialize_clone', '$initialize_copy', '$private', '$singleton_class', '$initialize_dup', '$for', '$to_proc', '$include', '$to_i', '$to_s', '$to_f', '$*', '$===', '$empty?', '$ArgumentError', '$nan?', '$infinite?', '$to_int', '$>', '$length', '$print', '$format', '$puts', '$each', '$<=', '$[]', '$nil?', '$is_a?', '$rand', '$coerce_to']);
  return (function($base) {
    var self = $module($base, 'Kernel');

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_9;
    def.$method_missing = TMP_1 = function(symbol, args) {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil;
      args = $slice.call(arguments, 1);
      TMP_1._p = null;
      return self.$raise((($a = $scope.NoMethodError) == null ? $opal.cm('NoMethodError') : $a), "undefined method `" + (symbol) + "' for " + (self.$inspect()));
    };

    def['$=~'] = function(obj) {
      var self = this;
      return false;
    };

    def['$==='] = function(other) {
      var self = this;
      return self['$=='](other);
    };

    def['$<=>'] = function(other) {
      var self = this;
      
      if (self['$=='](other)) {
        return 0;
      }

      return nil;
    ;
    };

    def.$method = function(name) {
      var $a, self = this;
      
      var meth = self['$' + name];

      if (!meth || meth.rb_stub) {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "undefined method `" + (name) + "' for class `" + (self.$class().$name()) + "'");
      }

      return (($a = $scope.Method) == null ? $opal.cm('Method') : $a).$new(self, meth, name);
    
    };

    def.$methods = function(all) {
      var self = this;
      if (all == null) {
        all = true
      }
      
      var methods = [];

      for (var key in self) {
        if (key[0] == "$" && typeof(self[key]) === "function") {
          if (all == false || all === nil) {
            if (!$opal.hasOwnProperty.call(self, key)) {
              continue;
            }
          }

          methods.push(key.substr(1));
        }
      }

      return methods;
    
    };

    def.$Array = TMP_2 = function(object, args) {
      var self = this, $iter = TMP_2._p, block = $iter || nil;
      args = $slice.call(arguments, 1);
      TMP_2._p = null;
      
      if (object == null || object === nil) {
        return [];
      }
      else if (object['$respond_to?']("to_ary")) {
        return object.$to_ary();
      }
      else if (object['$respond_to?']("to_a")) {
        return object.$to_a();
      }
      else {
        return [object];
      }
    ;
    };

    def.$caller = function() {
      var self = this;
      return [];
    };

    def.$class = function() {
      var self = this;
      return self._klass;
    };

    def.$copy_instance_variables = function(other) {
      var self = this;
      
      for (var name in other) {
        if (name.charAt(0) !== '$') {
          if (name !== '_id' && name !== '_klass') {
            self[name] = other[name];
          }
        }
      }
    
    };

    def.$clone = function() {
      var self = this, copy = nil;
      copy = self.$class().$allocate();
      copy.$copy_instance_variables(self);
      copy.$initialize_clone(self);
      return copy;
    };

    def.$initialize_clone = function(other) {
      var self = this;
      return self.$initialize_copy(other);
    };

    self.$private("initialize_clone");

    def.$define_singleton_method = TMP_3 = function(name) {
      var $a, self = this, $iter = TMP_3._p, body = $iter || nil;
      TMP_3._p = null;
      if (($a = body) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to create Proc object without a block")};
      
      var jsid   = '$' + name;
      body._jsid = name;
      body._s    = null;
      body._def  = body;

      self.$singleton_class()._proto[jsid] = body;

      return self;
    
    };

    def.$dup = function() {
      var self = this, copy = nil;
      copy = self.$class().$allocate();
      copy.$copy_instance_variables(self);
      copy.$initialize_dup(self);
      return copy;
    };

    def.$initialize_dup = function(other) {
      var self = this;
      return self.$initialize_copy(other);
    };

    self.$private("initialize_dup");

    def.$enum_for = TMP_4 = function(method, args) {
      var $a, $b, $c, self = this, $iter = TMP_4._p, block = $iter || nil;
      args = $slice.call(arguments, 1);
      if (method == null) {
        method = "each"
      }
      TMP_4._p = null;
      return ($a = ($b = (($c = $scope.Enumerator) == null ? $opal.cm('Enumerator') : $c)).$for, $a._p = block.$to_proc(), $a).apply($b, [self, method].concat(args));
    };

    def['$equal?'] = function(other) {
      var self = this;
      return self === other;
    };

    def.$extend = function(mods) {
      var self = this;
      mods = $slice.call(arguments, 0);
      
      for (var i = 0, length = mods.length; i < length; i++) {
        self.$singleton_class().$include(mods[i]);
      }

      return self;
    
    };

    def.$format = function(format, args) {
      var self = this;
      args = $slice.call(arguments, 1);
      
      var idx = 0;
      return format.replace(/%(\d+\$)?([-+ 0]*)(\d*|\*(\d+\$)?)(?:\.(\d*|\*(\d+\$)?))?([cspdiubBoxXfgeEG])|(%%)/g, function(str, idx_str, flags, width_str, w_idx_str, prec_str, p_idx_str, spec, escaped) {
        if (escaped) {
          return '%';
        }

        var width,
        prec,
        is_integer_spec = ("diubBoxX".indexOf(spec) != -1),
        is_float_spec = ("eEfgG".indexOf(spec) != -1),
        prefix = '',
        obj;

        if (width_str === undefined) {
          width = undefined;
        } else if (width_str.charAt(0) == '*') {
          var w_idx = idx++;
          if (w_idx_str) {
            w_idx = parseInt(w_idx_str, 10) - 1;
          }
          width = (args[w_idx]).$to_i();
        } else {
          width = parseInt(width_str, 10);
        }
        if (!prec_str) {
          prec = is_float_spec ? 6 : undefined;
        } else if (prec_str.charAt(0) == '*') {
          var p_idx = idx++;
          if (p_idx_str) {
            p_idx = parseInt(p_idx_str, 10) - 1;
          }
          prec = (args[p_idx]).$to_i();
        } else {
          prec = parseInt(prec_str, 10);
        }
        if (idx_str) {
          idx = parseInt(idx_str, 10) - 1;
        }
        switch (spec) {
        case 'c':
          obj = args[idx];
          if (obj._isString) {
            str = obj.charAt(0);
          } else {
            str = String.fromCharCode((obj).$to_i());
          }
          break;
        case 's':
          str = (args[idx]).$to_s();
          if (prec !== undefined) {
            str = str.substr(0, prec);
          }
          break;
        case 'p':
          str = (args[idx]).$inspect();
          if (prec !== undefined) {
            str = str.substr(0, prec);
          }
          break;
        case 'd':
        case 'i':
        case 'u':
          str = (args[idx]).$to_i().toString();
          break;
        case 'b':
        case 'B':
          str = (args[idx]).$to_i().toString(2);
          break;
        case 'o':
          str = (args[idx]).$to_i().toString(8);
          break;
        case 'x':
        case 'X':
          str = (args[idx]).$to_i().toString(16);
          break;
        case 'e':
        case 'E':
          str = (args[idx]).$to_f().toExponential(prec);
          break;
        case 'f':
          str = (args[idx]).$to_f().toFixed(prec);
          break;
        case 'g':
        case 'G':
          str = (args[idx]).$to_f().toPrecision(prec);
          break;
        }
        idx++;
        if (is_integer_spec || is_float_spec) {
          if (str.charAt(0) == '-') {
            prefix = '-';
            str = str.substr(1);
          } else {
            if (flags.indexOf('+') != -1) {
              prefix = '+';
            } else if (flags.indexOf(' ') != -1) {
              prefix = ' ';
            }
          }
        }
        if (is_integer_spec && prec !== undefined) {
          if (str.length < prec) {
            str = "0"['$*'](prec - str.length) + str;
          }
        }
        var total_len = prefix.length + str.length;
        if (width !== undefined && total_len < width) {
          if (flags.indexOf('-') != -1) {
            str = str + " "['$*'](width - total_len);
          } else {
            var pad_char = ' ';
            if (flags.indexOf('0') != -1) {
              str = "0"['$*'](width - total_len) + str;
            } else {
              prefix = " "['$*'](width - total_len) + prefix;
            }
          }
        }
        var result = prefix + str;
        if ('XEG'.indexOf(spec) != -1) {
          result = result.toUpperCase();
        }
        return result;
      });
    
    };

    def.$hash = function() {
      var self = this;
      return self._id;
    };

    def.$initialize_copy = function(other) {
      var self = this;
      return nil;
    };

    def.$inspect = function() {
      var self = this;
      return self.$to_s();
    };

    def['$instance_of?'] = function(klass) {
      var self = this;
      return self._klass === klass;
    };

    def['$instance_variable_defined?'] = function(name) {
      var self = this;
      return self.hasOwnProperty(name.substr(1));
    };

    def.$instance_variable_get = function(name) {
      var self = this;
      
      var ivar = self[name.substr(1)];

      return ivar == null ? nil : ivar;
    
    };

    def.$instance_variable_set = function(name, value) {
      var self = this;
      return self[name.substr(1)] = value;
    };

    def.$instance_variables = function() {
      var self = this;
      
      var result = [];

      for (var name in self) {
        if (name.charAt(0) !== '$') {
          if (name !== '_klass' && name !== '_id') {
            result.push('@' + name);
          }
        }
      }

      return result;
    
    };

    def.$Integer = function(value, base) {
      var $a, $b, self = this, $case = nil;
      if (base == null) {
        base = nil
      }
      if (($a = (($b = $scope.String) == null ? $opal.cm('String') : $b)['$==='](value)) !== false && $a !== nil) {
        if (($a = value['$empty?']()) !== false && $a !== nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "invalid value for Integer: (empty string)")};
        return parseInt(value, ((($a = base) !== false && $a !== nil) ? $a : undefined));};
      if (base !== false && base !== nil) {
        self.$raise(self.$ArgumentError("base is only valid for String values"))};
      return (function() {$case = value;if ((($a = $scope.Integer) == null ? $opal.cm('Integer') : $a)['$===']($case)) {return value}else if ((($a = $scope.Float) == null ? $opal.cm('Float') : $a)['$===']($case)) {if (($a = ((($b = value['$nan?']()) !== false && $b !== nil) ? $b : value['$infinite?']())) !== false && $a !== nil) {
        self.$raise((($a = $scope.FloatDomainError) == null ? $opal.cm('FloatDomainError') : $a), "unable to coerce " + (value) + " to Integer")};
      return value.$to_int();}else if ((($a = $scope.NilClass) == null ? $opal.cm('NilClass') : $a)['$===']($case)) {return self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "can't convert nil into Integer")}else {if (($a = value['$respond_to?']("to_int")) !== false && $a !== nil) {
        return value.$to_int()
      } else if (($a = value['$respond_to?']("to_i")) !== false && $a !== nil) {
        return value.$to_i()
        } else {
        return self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "can't convert " + (value.$class()) + " into Integer")
      }}})();
    };

    def.$Float = function(value) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.String) == null ? $opal.cm('String') : $b)['$==='](value)) !== false && $a !== nil) {
        return parseFloat(value);
      } else if (($a = value['$respond_to?']("to_f")) !== false && $a !== nil) {
        return value.$to_f()
        } else {
        return self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "can't convert " + (value.$class()) + " into Float")
      };
    };

    def['$is_a?'] = function(klass) {
      var self = this;
      return $opal.is_a(self, klass);
    };

    $opal.defn(self, '$kind_of?', def['$is_a?']);

    def.$lambda = TMP_5 = function() {
      var self = this, $iter = TMP_5._p, block = $iter || nil;
      TMP_5._p = null;
      block.is_lambda = true;
      return block;
    };

    def.$loop = TMP_6 = function() {
      var self = this, $iter = TMP_6._p, block = $iter || nil;
      TMP_6._p = null;
      
      while (true) {
        if (block() === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def['$nil?'] = function() {
      var self = this;
      return false;
    };

    $opal.defn(self, '$object_id', def.$__id__);

    def.$printf = function(args) {
      var $a, self = this;
      args = $slice.call(arguments, 0);
      if (args.$length()['$>'](0)) {
        self.$print(($a = self).$format.apply($a, [].concat(args)))};
      return nil;
    };

    def.$private_methods = function() {
      var self = this;
      return [];
    };

    def.$proc = TMP_7 = function() {
      var $a, self = this, $iter = TMP_7._p, block = $iter || nil;
      TMP_7._p = null;
      if (($a = block) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to create Proc object without a block")};
      block.is_lambda = false;
      return block;
    };

    def.$puts = function(strs) {
      var $a, self = this;
      strs = $slice.call(arguments, 0);
      return ($a = $gvars["stdout"]).$puts.apply($a, [].concat(strs));
    };

    def.$p = function(args) {
      var $a, $b, TMP_8, self = this;
      args = $slice.call(arguments, 0);
      ($a = ($b = args).$each, $a._p = (TMP_8 = function(obj){var self = TMP_8._s || this;if (obj == null) obj = nil;
      return $gvars["stdout"].$puts(obj.$inspect())}, TMP_8._s = self, TMP_8), $a).call($b);
      if (args.$length()['$<='](1)) {
        return args['$[]'](0)
        } else {
        return args
      };
    };

    $opal.defn(self, '$print', def.$puts);

    def.$warn = function(strs) {
      var $a, $b, self = this;
      strs = $slice.call(arguments, 0);
      if (($a = ((($b = $gvars["VERBOSE"]['$nil?']()) !== false && $b !== nil) ? $b : strs['$empty?']())) === false || $a === nil) {
        ($a = $gvars["stderr"]).$puts.apply($a, [].concat(strs))};
      return nil;
    };

    def.$raise = function(exception, string) {
      var $a, self = this;
      
      if (exception == null && $gvars["!"]) {
        exception = $gvars["!"];
      }
      else if (exception._isString) {
        exception = (($a = $scope.RuntimeError) == null ? $opal.cm('RuntimeError') : $a).$new(exception);
      }
      else if (!exception['$is_a?']((($a = $scope.Exception) == null ? $opal.cm('Exception') : $a))) {
        exception = exception.$new(string);
      }

      throw exception;
    ;
    };

    $opal.defn(self, '$fail', def.$raise);

    def.$rand = function(max) {
      var $a, self = this;
      
      if (max === undefined) {
        return Math.random();
      }
      else if (max._isRange) {
        var arr = max.$to_a();

        return arr[self.$rand(arr.length)];
      }
      else {
        return Math.floor(Math.random() *
          Math.abs((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(max, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")));
      }
    
    };

    $opal.defn(self, '$srand', def.$rand);

    def['$respond_to?'] = function(name, include_all) {
      var self = this;
      if (include_all == null) {
        include_all = false
      }
      
      var body = self['$' + name];
      return (!!body) && !body.rb_stub;
    
    };

    $opal.defn(self, '$send', def.$__send__);

    $opal.defn(self, '$public_send', def.$__send__);

    def.$singleton_class = function() {
      var self = this;
      
      if (self._isClass) {
        if (self.__meta__) {
          return self.__meta__;
        }

        var meta = new $opal.Class._alloc;
        meta._klass = $opal.Class;
        self.__meta__ = meta;
        // FIXME - is this right? (probably - methods defined on
        // class' singleton should also go to subclasses?)
        meta._proto = self.constructor.prototype;
        meta._isSingleton = true;
        meta.__inc__ = [];
        meta._methods = [];

        meta._scope = self._scope;

        return meta;
      }

      if (self._isClass) {
        return self._klass;
      }

      if (self.__meta__) {
        return self.__meta__;
      }

      else {
        var orig_class = self._klass,
            class_id   = "#<Class:#<" + orig_class._name + ":" + orig_class._id + ">>";

        var Singleton = function () {};
        var meta = Opal.boot(orig_class, Singleton);
        meta._name = class_id;

        meta._proto = self;
        self.__meta__ = meta;
        meta._klass = orig_class._klass;
        meta._scope = orig_class._scope;
        meta.__parent = orig_class;

        return meta;
      }
    
    };

    $opal.defn(self, '$sprintf', def.$format);

    def.$String = function(str) {
      var self = this;
      return String(str);
    };

    def.$tap = TMP_9 = function() {
      var self = this, $iter = TMP_9._p, block = $iter || nil;
      TMP_9._p = null;
      if ($opal.$yield1(block, self) === $breaker) return $breaker.$v;
      return self;
    };

    def.$to_proc = function() {
      var self = this;
      return self;
    };

    def.$to_s = function() {
      var self = this;
      return "#<" + self.$class().$name() + ":" + self._id + ">";
    };

    def.$freeze = function() {
      var self = this;
      self.___frozen___ = true;
      return self;
    };

    def['$frozen?'] = function() {
      var $a, self = this;
      if (self.___frozen___ == null) self.___frozen___ = nil;

      return ((($a = self.___frozen___) !== false && $a !== nil) ? $a : false);
    };

    def['$respond_to_missing?'] = function(method_name) {
      var self = this;
      return false;
    };
        ;$opal.donate(self, ["$method_missing", "$=~", "$===", "$<=>", "$method", "$methods", "$Array", "$caller", "$class", "$copy_instance_variables", "$clone", "$initialize_clone", "$define_singleton_method", "$dup", "$initialize_dup", "$enum_for", "$equal?", "$extend", "$format", "$hash", "$initialize_copy", "$inspect", "$instance_of?", "$instance_variable_defined?", "$instance_variable_get", "$instance_variable_set", "$instance_variables", "$Integer", "$Float", "$is_a?", "$kind_of?", "$lambda", "$loop", "$nil?", "$object_id", "$printf", "$private_methods", "$proc", "$puts", "$p", "$print", "$warn", "$raise", "$fail", "$rand", "$srand", "$respond_to?", "$send", "$public_send", "$singleton_class", "$sprintf", "$String", "$tap", "$to_proc", "$to_s", "$freeze", "$frozen?", "$respond_to_missing?"]);
  })(self)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/kernel.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$raise']);
  (function($base, $super) {
    function $NilClass(){};
    var self = $NilClass = $klass($base, $super, 'NilClass', $NilClass);

    var def = $NilClass._proto, $scope = $NilClass._scope;
    def['$&'] = function(other) {
      var self = this;
      return false;
    };

    def['$|'] = function(other) {
      var self = this;
      return other !== false && other !== nil;
    };

    def['$^'] = function(other) {
      var self = this;
      return other !== false && other !== nil;
    };

    def['$=='] = function(other) {
      var self = this;
      return other === nil;
    };

    def.$dup = function() {
      var $a, self = this;
      return self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a));
    };

    def.$inspect = function() {
      var self = this;
      return "nil";
    };

    def['$nil?'] = function() {
      var self = this;
      return true;
    };

    def.$singleton_class = function() {
      var $a, self = this;
      return (($a = $scope.NilClass) == null ? $opal.cm('NilClass') : $a);
    };

    def.$to_a = function() {
      var self = this;
      return [];
    };

    def.$to_h = function() {
      var self = this;
      return $opal.hash();
    };

    def.$to_i = function() {
      var self = this;
      return 0;
    };

    $opal.defn(self, '$to_f', def.$to_i);

    def.$to_s = function() {
      var self = this;
      return "";
    };

    def.$object_id = function() {
      var $a, self = this;
      return (($a = $scope.NilClass) == null ? $opal.cm('NilClass') : $a)._id || ((($a = $scope.NilClass) == null ? $opal.cm('NilClass') : $a)._id = $opal.uid());
    };

    return $opal.defn(self, '$hash', def.$object_id);
  })(self, null);
  return $opal.cdecl($scope, 'NIL', nil);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/nil_class.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$undef_method']);
  (function($base, $super) {
    function $Boolean(){};
    var self = $Boolean = $klass($base, $super, 'Boolean', $Boolean);

    var def = $Boolean._proto, $scope = $Boolean._scope;
    def._isBoolean = true;

    (function(self) {
      var $scope = self._scope, def = self._proto;
      return self.$undef_method("new")
    })(self.$singleton_class());

    def['$&'] = function(other) {
      var self = this;
      return (self == true) ? (other !== false && other !== nil) : false;
    };

    def['$|'] = function(other) {
      var self = this;
      return (self == true) ? true : (other !== false && other !== nil);
    };

    def['$^'] = function(other) {
      var self = this;
      return (self == true) ? (other === false || other === nil) : (other !== false && other !== nil);
    };

    def['$=='] = function(other) {
      var self = this;
      return (self == true) === other.valueOf();
    };

    $opal.defn(self, '$equal?', def['$==']);

    $opal.defn(self, '$singleton_class', def.$class);

    return (def.$to_s = function() {
      var self = this;
      return (self == true) ? 'true' : 'false';
    }, nil);
  })(self, null);
  $opal.cdecl($scope, 'TrueClass', (($a = $scope.Boolean) == null ? $opal.cm('Boolean') : $a));
  $opal.cdecl($scope, 'FalseClass', (($a = $scope.Boolean) == null ? $opal.cm('Boolean') : $a));
  $opal.cdecl($scope, 'TRUE', true);
  return $opal.cdecl($scope, 'FALSE', false);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/boolean.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $module = $opal.module;
  $opal.add_stubs(['$attr_reader', '$name', '$class']);
  (function($base, $super) {
    function $Exception(){};
    var self = $Exception = $klass($base, $super, 'Exception', $Exception);

    var def = $Exception._proto, $scope = $Exception._scope;
    def.message = nil;
    self.$attr_reader("message");

    $opal.defs(self, '$new', function(message) {
      var self = this;
      if (message == null) {
        message = ""
      }
      
      var err = new Error(message);
      err._klass = self;
      err.name = self._name;
      return err;
    
    });

    def.$backtrace = function() {
      var self = this;
      
      var backtrace = self.stack;

      if (typeof(backtrace) === 'string') {
        return backtrace.split("\n").slice(0, 15);
      }
      else if (backtrace) {
        return backtrace.slice(0, 15);
      }

      return [];
    
    };

    def.$inspect = function() {
      var self = this;
      return "#<" + (self.$class().$name()) + ": '" + (self.message) + "'>";
    };

    return $opal.defn(self, '$to_s', def.$message);
  })(self, null);
  (function($base, $super) {
    function $StandardError(){};
    var self = $StandardError = $klass($base, $super, 'StandardError', $StandardError);

    var def = $StandardError._proto, $scope = $StandardError._scope;
    return nil;
  })(self, (($a = $scope.Exception) == null ? $opal.cm('Exception') : $a));
  (function($base, $super) {
    function $SystemCallError(){};
    var self = $SystemCallError = $klass($base, $super, 'SystemCallError', $SystemCallError);

    var def = $SystemCallError._proto, $scope = $SystemCallError._scope;
    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $NameError(){};
    var self = $NameError = $klass($base, $super, 'NameError', $NameError);

    var def = $NameError._proto, $scope = $NameError._scope;
    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $NoMethodError(){};
    var self = $NoMethodError = $klass($base, $super, 'NoMethodError', $NoMethodError);

    var def = $NoMethodError._proto, $scope = $NoMethodError._scope;
    return nil;
  })(self, (($a = $scope.NameError) == null ? $opal.cm('NameError') : $a));
  (function($base, $super) {
    function $RuntimeError(){};
    var self = $RuntimeError = $klass($base, $super, 'RuntimeError', $RuntimeError);

    var def = $RuntimeError._proto, $scope = $RuntimeError._scope;
    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $LocalJumpError(){};
    var self = $LocalJumpError = $klass($base, $super, 'LocalJumpError', $LocalJumpError);

    var def = $LocalJumpError._proto, $scope = $LocalJumpError._scope;
    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $TypeError(){};
    var self = $TypeError = $klass($base, $super, 'TypeError', $TypeError);

    var def = $TypeError._proto, $scope = $TypeError._scope;
    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $ArgumentError(){};
    var self = $ArgumentError = $klass($base, $super, 'ArgumentError', $ArgumentError);

    var def = $ArgumentError._proto, $scope = $ArgumentError._scope;
    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $IndexError(){};
    var self = $IndexError = $klass($base, $super, 'IndexError', $IndexError);

    var def = $IndexError._proto, $scope = $IndexError._scope;
    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $StopIteration(){};
    var self = $StopIteration = $klass($base, $super, 'StopIteration', $StopIteration);

    var def = $StopIteration._proto, $scope = $StopIteration._scope;
    return nil;
  })(self, (($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a));
  (function($base, $super) {
    function $KeyError(){};
    var self = $KeyError = $klass($base, $super, 'KeyError', $KeyError);

    var def = $KeyError._proto, $scope = $KeyError._scope;
    return nil;
  })(self, (($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a));
  (function($base, $super) {
    function $RangeError(){};
    var self = $RangeError = $klass($base, $super, 'RangeError', $RangeError);

    var def = $RangeError._proto, $scope = $RangeError._scope;
    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $FloatDomainError(){};
    var self = $FloatDomainError = $klass($base, $super, 'FloatDomainError', $FloatDomainError);

    var def = $FloatDomainError._proto, $scope = $FloatDomainError._scope;
    return nil;
  })(self, (($a = $scope.RangeError) == null ? $opal.cm('RangeError') : $a));
  (function($base, $super) {
    function $IOError(){};
    var self = $IOError = $klass($base, $super, 'IOError', $IOError);

    var def = $IOError._proto, $scope = $IOError._scope;
    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $ScriptError(){};
    var self = $ScriptError = $klass($base, $super, 'ScriptError', $ScriptError);

    var def = $ScriptError._proto, $scope = $ScriptError._scope;
    return nil;
  })(self, (($a = $scope.Exception) == null ? $opal.cm('Exception') : $a));
  (function($base, $super) {
    function $SyntaxError(){};
    var self = $SyntaxError = $klass($base, $super, 'SyntaxError', $SyntaxError);

    var def = $SyntaxError._proto, $scope = $SyntaxError._scope;
    return nil;
  })(self, (($a = $scope.ScriptError) == null ? $opal.cm('ScriptError') : $a));
  (function($base, $super) {
    function $NotImplementedError(){};
    var self = $NotImplementedError = $klass($base, $super, 'NotImplementedError', $NotImplementedError);

    var def = $NotImplementedError._proto, $scope = $NotImplementedError._scope;
    return nil;
  })(self, (($a = $scope.ScriptError) == null ? $opal.cm('ScriptError') : $a));
  (function($base, $super) {
    function $SystemExit(){};
    var self = $SystemExit = $klass($base, $super, 'SystemExit', $SystemExit);

    var def = $SystemExit._proto, $scope = $SystemExit._scope;
    return nil;
  })(self, (($a = $scope.Exception) == null ? $opal.cm('Exception') : $a));
  return (function($base) {
    var self = $module($base, 'Errno');

    var def = self._proto, $scope = self._scope, $a;
    (function($base, $super) {
      function $EINVAL(){};
      var self = $EINVAL = $klass($base, $super, 'EINVAL', $EINVAL);

      var def = $EINVAL._proto, $scope = $EINVAL._scope, TMP_1;
      return ($opal.defs(self, '$new', TMP_1 = function() {
        var self = this, $iter = TMP_1._p, $yield = $iter || nil;
        TMP_1._p = null;
        return $opal.find_super_dispatcher(self, 'new', TMP_1, null, $EINVAL).apply(self, ["Invalid argument"]);
      }), nil)
    })(self, (($a = $scope.SystemCallError) == null ? $opal.cm('SystemCallError') : $a))
    
  })(self);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/error.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $gvars = $opal.gvars;
  $opal.add_stubs(['$respond_to?', '$to_str', '$to_s', '$coerce_to', '$new', '$raise', '$class']);
  return (function($base, $super) {
    function $Regexp(){};
    var self = $Regexp = $klass($base, $super, 'Regexp', $Regexp);

    var def = $Regexp._proto, $scope = $Regexp._scope;
    def._isRegexp = true;

    $opal.defs(self, '$escape', function(string) {
      var self = this;
      return string.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\^\$\| ]/g, '\\$&');
    });

    $opal.defs(self, '$union', function(parts) {
      var self = this;
      parts = $slice.call(arguments, 0);
      return new RegExp(parts.join(''));
    });

    $opal.defs(self, '$new', function(regexp, options) {
      var self = this;
      return new RegExp(regexp, options);
    });

    def['$=='] = function(other) {
      var self = this;
      return other.constructor == RegExp && self.toString() === other.toString();
    };

    def['$==='] = function(str) {
      var $a, $b, self = this;
      if (($a = ($b = str._isString == null, $b !== false && $b !== nil ?str['$respond_to?']("to_str") : $b)) !== false && $a !== nil) {
        str = str.$to_str()};
      if (($a = str._isString == null) !== false && $a !== nil) {
        return false};
      return self.test(str);
    };

    def['$=~'] = function(string) {
      var $a, self = this;
      if (($a = string === nil) !== false && $a !== nil) {
        $gvars["~"] = $gvars["`"] = $gvars["'"] = nil;
        return nil;};
      string = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(string, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      
      var re = self;

      if (re.global) {
        // should we clear it afterwards too?
        re.lastIndex = 0;
      }
      else {
        // rewrite regular expression to add the global flag to capture pre/post match
        re = new RegExp(re.source, 'g' + (re.multiline ? 'm' : '') + (re.ignoreCase ? 'i' : ''));
      }

      var result = re.exec(string);

      if (result) {
        $gvars["~"] = (($a = $scope.MatchData) == null ? $opal.cm('MatchData') : $a).$new(re, result);
      }
      else {
        $gvars["~"] = $gvars["`"] = $gvars["'"] = nil;
      }

      return result ? result.index : nil;
    
    };

    $opal.defn(self, '$eql?', def['$==']);

    def.$inspect = function() {
      var self = this;
      return self.toString();
    };

    def.$match = function(string, pos) {
      var $a, self = this;
      if (($a = string === nil) !== false && $a !== nil) {
        $gvars["~"] = $gvars["`"] = $gvars["'"] = nil;
        return nil;};
      if (($a = string._isString == null) !== false && $a !== nil) {
        if (($a = string['$respond_to?']("to_str")) === false || $a === nil) {
          self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "no implicit conversion of " + (string.$class()) + " into String")};
        string = string.$to_str();};
      
      var re = self;

      if (re.global) {
        // should we clear it afterwards too?
        re.lastIndex = 0;
      }
      else {
        re = new RegExp(re.source, 'g' + (re.multiline ? 'm' : '') + (re.ignoreCase ? 'i' : ''));
      }

      var result = re.exec(string);

      if (result) {
        return $gvars["~"] = (($a = $scope.MatchData) == null ? $opal.cm('MatchData') : $a).$new(re, result);
      }
      else {
        return $gvars["~"] = $gvars["`"] = $gvars["'"] = nil;
      }
    
    };

    def.$source = function() {
      var self = this;
      return self.source;
    };

    return $opal.defn(self, '$to_s', def.$source);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/regexp.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module;
  $opal.add_stubs(['$===', '$>', '$<', '$equal?', '$<=>', '$==', '$normalize', '$raise', '$class', '$>=', '$<=']);
  return (function($base) {
    var self = $module($base, 'Comparable');

    var def = self._proto, $scope = self._scope;
    $opal.defs(self, '$normalize', function(what) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](what)) !== false && $a !== nil) {
        return what};
      if (what['$>'](0)) {
        return 1};
      if (what['$<'](0)) {
        return -1};
      return 0;
    });

    def['$=='] = function(other) {
      var $a, self = this, cmp = nil;
      try {
      if (($a = self['$equal?'](other)) !== false && $a !== nil) {
          return true};
        if (($a = cmp = (self['$<=>'](other))) === false || $a === nil) {
          return false};
        return (($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a).$normalize(cmp)['$=='](0);
      } catch ($err) {if ((($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a)['$===']($err)) {
        return false
        }else { throw $err; }
      };
    };

    def['$>'] = function(other) {
      var $a, self = this, cmp = nil;
      if (($a = cmp = (self['$<=>'](other))) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")};
      return (($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a).$normalize(cmp)['$>'](0);
    };

    def['$>='] = function(other) {
      var $a, self = this, cmp = nil;
      if (($a = cmp = (self['$<=>'](other))) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")};
      return (($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a).$normalize(cmp)['$>='](0);
    };

    def['$<'] = function(other) {
      var $a, self = this, cmp = nil;
      if (($a = cmp = (self['$<=>'](other))) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")};
      return (($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a).$normalize(cmp)['$<'](0);
    };

    def['$<='] = function(other) {
      var $a, self = this, cmp = nil;
      if (($a = cmp = (self['$<=>'](other))) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")};
      return (($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a).$normalize(cmp)['$<='](0);
    };

    def['$between?'] = function(min, max) {
      var self = this;
      if (self['$<'](min)) {
        return false};
      if (self['$>'](max)) {
        return false};
      return true;
    };
        ;$opal.donate(self, ["$==", "$>", "$>=", "$<", "$<=", "$between?"]);
  })(self)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/comparable.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module;
  $opal.add_stubs(['$raise', '$enum_for', '$==', '$destructure', '$nil?', '$coerce_to!', '$coerce_to', '$===', '$new', '$<<', '$[]', '$[]=', '$inspect', '$__send__', '$yield', '$enumerator_size', '$respond_to?', '$size', '$private', '$compare', '$<=>', '$dup', '$map', '$sort', '$call', '$first']);
  return (function($base) {
    var self = $module($base, 'Enumerable');

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12, TMP_13, TMP_14, TMP_15, TMP_16, TMP_17, TMP_18, TMP_19, TMP_21, TMP_22, TMP_23, TMP_24, TMP_25, TMP_26, TMP_27, TMP_28, TMP_29, TMP_30, TMP_31, TMP_33, TMP_34, TMP_38, TMP_39;
    def['$all?'] = TMP_1 = function() {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil;
      TMP_1._p = null;
      
      var result = true;

      if (block !== nil) {
        self.$each._p = function() {
          var value = $opal.$yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (($a = value) === false || $a === nil) {
            result = false;
            return $breaker;
          }
        }
      }
      else {
        self.$each._p = function(obj) {
          if (arguments.length == 1 && ($a = obj) === false || $a === nil) {
            result = false;
            return $breaker;
          }
        }
      }

      self.$each();

      return result;
    
    };

    def['$any?'] = TMP_2 = function() {
      var $a, self = this, $iter = TMP_2._p, block = $iter || nil;
      TMP_2._p = null;
      
      var result = false;

      if (block !== nil) {
        self.$each._p = function() {
          var value = $opal.$yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (($a = value) !== false && $a !== nil) {
            result = true;
            return $breaker;
          }
        };
      }
      else {
        self.$each._p = function(obj) {
          if (arguments.length != 1 || ($a = obj) !== false && $a !== nil) {
            result = true;
            return $breaker;
          }
        }
      }

      self.$each();

      return result;
    
    };

    def.$chunk = TMP_3 = function(state) {
      var $a, self = this, $iter = TMP_3._p, block = $iter || nil;
      TMP_3._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$collect = TMP_4 = function() {
      var self = this, $iter = TMP_4._p, block = $iter || nil;
      TMP_4._p = null;
      if (block === nil) {
        return self.$enum_for("collect")};
      
      var result = [];

      self.$each._p = function() {
        var value = $opal.$yieldX(block, arguments);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        result.push(value);
      };

      self.$each();

      return result;
    
    };

    def.$collect_concat = TMP_5 = function() {
      var $a, self = this, $iter = TMP_5._p, block = $iter || nil;
      TMP_5._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$count = TMP_6 = function(object) {
      var $a, self = this, $iter = TMP_6._p, block = $iter || nil;
      TMP_6._p = null;
      
      var result = 0;

      if (object != null) {
        block = function() {
          return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments)['$=='](object);
        };
      }
      else if (block === nil) {
        block = function() { return true; };
      }

      self.$each._p = function() {
        var value = $opal.$yieldX(block, arguments);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if (($a = value) !== false && $a !== nil) {
          result++;
        }
      }

      self.$each();

      return result;
    
    };

    def.$cycle = TMP_7 = function(n) {
      var $a, self = this, $iter = TMP_7._p, block = $iter || nil;
      if (n == null) {
        n = nil
      }
      TMP_7._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("cycle", n)};
      if (($a = n['$nil?']()) === false || $a === nil) {
        n = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](n, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if (($a = n <= 0) !== false && $a !== nil) {
          return nil};};
      
      var result,
          all  = [];

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        all.push(param);
      }

      self.$each();

      if (result !== undefined) {
        return result;
      }

      if (all.length === 0) {
        return nil;
      }
    
      if (($a = n['$nil?']()) !== false && $a !== nil) {
        
        while (true) {
          for (var i = 0, length = all.length; i < length; i++) {
            var value = $opal.$yield1(block, all[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }
        }
      
        } else {
        
        while (n > 1) {
          for (var i = 0, length = all.length; i < length; i++) {
            var value = $opal.$yield1(block, all[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }

          n--;
        }
      
      };
    };

    def.$detect = TMP_8 = function(ifnone) {
      var $a, self = this, $iter = TMP_8._p, block = $iter || nil;
      TMP_8._p = null;
      if (block === nil) {
        return self.$enum_for("detect", ifnone)};
      
      var result = undefined;

      self.$each._p = function() {
        var params = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value  = $opal.$yield1(block, params);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if (($a = value) !== false && $a !== nil) {
          result = params;
          return $breaker;
        }
      };

      self.$each();

      if (result === undefined && ifnone !== undefined) {
        if (typeof(ifnone) === 'function') {
          result = ifnone();
        }
        else {
          result = ifnone;
        }
      }

      return result === undefined ? nil : result;
    
    };

    def.$drop = function(number) {
      var $a, self = this;
      number = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(number, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      if (($a = number < 0) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "attempt to drop negative size")};
      
      var result  = [],
          current = 0;

      self.$each._p = function() {
        if (number <= current) {
          result.push((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments));
        }

        current++;
      };

      self.$each()

      return result;
    
    };

    def.$drop_while = TMP_9 = function() {
      var $a, self = this, $iter = TMP_9._p, block = $iter || nil;
      TMP_9._p = null;
      if (block === nil) {
        return self.$enum_for("drop_while")};
      
      var result   = [],
          dropping = true;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

        if (dropping) {
          var value = $opal.$yield1(block, param);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (($a = value) === false || $a === nil) {
            dropping = false;
            result.push(param);
          }
        }
        else {
          result.push(param);
        }
      };

      self.$each();

      return result;
    
    };

    def.$each_cons = TMP_10 = function(n) {
      var $a, self = this, $iter = TMP_10._p, block = $iter || nil;
      TMP_10._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$each_entry = TMP_11 = function() {
      var $a, self = this, $iter = TMP_11._p, block = $iter || nil;
      TMP_11._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$each_slice = TMP_12 = function(n) {
      var $a, self = this, $iter = TMP_12._p, block = $iter || nil;
      TMP_12._p = null;
      n = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(n, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      if (($a = n <= 0) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "invalid slice size")};
      if (block === nil) {
        return self.$enum_for("each_slice", n)};
      
      var result,
          slice = []

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

        slice.push(param);

        if (slice.length === n) {
          if (block(slice) === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          slice = [];
        }
      };

      self.$each();

      if (result !== undefined) {
        return result;
      }

      // our "last" group, if smaller than n then won't have been yielded
      if (slice.length > 0) {
        if (block(slice) === $breaker) {
          return $breaker.$v;
        }
      }
    ;
      return nil;
    };

    def.$each_with_index = TMP_13 = function(args) {
      var $a, $b, self = this, $iter = TMP_13._p, block = $iter || nil;
      args = $slice.call(arguments, 0);
      TMP_13._p = null;
      if (block === nil) {
        return ($a = self).$enum_for.apply($a, ["each_with_index"].concat(args))};
      
      var result,
          index = 0;

      self.$each._p = function() {
        var param = (($b = $scope.Opal) == null ? $opal.cm('Opal') : $b).$destructure(arguments),
            value = block(param, index);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        index++;
      };

      self.$each.apply(self, args);

      if (result !== undefined) {
        return result;
      }
    
      return self;
    };

    def.$each_with_object = TMP_14 = function(object) {
      var $a, self = this, $iter = TMP_14._p, block = $iter || nil;
      TMP_14._p = null;
      if (block === nil) {
        return self.$enum_for("each_with_object", object)};
      
      var result;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = block(param, object);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }
      };

      self.$each();

      if (result !== undefined) {
        return result;
      }
    
      return object;
    };

    def.$entries = function(args) {
      var $a, self = this;
      args = $slice.call(arguments, 0);
      
      var result = [];

      self.$each._p = function() {
        result.push((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments));
      };

      self.$each.apply(self, args);

      return result;
    
    };

    $opal.defn(self, '$find', def.$detect);

    def.$find_all = TMP_15 = function() {
      var $a, self = this, $iter = TMP_15._p, block = $iter || nil;
      TMP_15._p = null;
      if (block === nil) {
        return self.$enum_for("find_all")};
      
      var result = [];

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if (($a = value) !== false && $a !== nil) {
          result.push(param);
        }
      };

      self.$each();

      return result;
    
    };

    def.$find_index = TMP_16 = function(object) {
      var $a, self = this, $iter = TMP_16._p, block = $iter || nil;
      TMP_16._p = null;
      if (($a = object === undefined && block === nil) !== false && $a !== nil) {
        return self.$enum_for("find_index")};
      
      var result = nil,
          index  = 0;

      if (object != null) {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if ((param)['$=='](object)) {
            result = index;
            return $breaker;
          }

          index += 1;
        };
      }
      else if (block !== nil) {
        self.$each._p = function() {
          var value = $opal.$yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (($a = value) !== false && $a !== nil) {
            result = index;
            return $breaker;
          }

          index += 1;
        };
      }

      self.$each();

      return result;
    
    };

    def.$first = function(number) {
      var $a, self = this, result = nil;
      if (($a = number === undefined) !== false && $a !== nil) {
        result = nil;
        
        self.$each._p = function() {
          result = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          return $breaker;
        };

        self.$each();
      ;
        } else {
        result = [];
        number = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(number, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if (($a = number < 0) !== false && $a !== nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "attempt to take negative size")};
        if (($a = number == 0) !== false && $a !== nil) {
          return []};
        
        var current = 0,
            number  = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(number, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

        self.$each._p = function() {
          result.push((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments));

          if (number <= ++current) {
            return $breaker;
          }
        };

        self.$each();
      ;
      };
      return result;
    };

    $opal.defn(self, '$flat_map', def.$collect_concat);

    def.$grep = TMP_17 = function(pattern) {
      var $a, self = this, $iter = TMP_17._p, block = $iter || nil;
      TMP_17._p = null;
      
      var result = [];

      if (block !== nil) {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
              value = pattern['$==='](param);

          if (($a = value) !== false && $a !== nil) {
            value = $opal.$yield1(block, param);

            if (value === $breaker) {
              result = $breaker.$v;
              return $breaker;
            }

            result.push(value);
          }
        };
      }
      else {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
              value = pattern['$==='](param);

          if (($a = value) !== false && $a !== nil) {
            result.push(param);
          }
        };
      }

      self.$each();

      return result;
    ;
    };

    def.$group_by = TMP_18 = function() {
      var $a, $b, $c, self = this, $iter = TMP_18._p, block = $iter || nil, hash = nil;
      TMP_18._p = null;
      if (block === nil) {
        return self.$enum_for("group_by")};
      hash = (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a).$new();
      
      var result;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        (($a = value, $b = hash, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, []))))['$<<'](param);
      }

      self.$each();

      if (result !== undefined) {
        return result;
      }
    
      return hash;
    };

    def['$include?'] = function(obj) {
      var $a, self = this;
      
      var result = false;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

        if ((param)['$=='](obj)) {
          result = true;
          return $breaker;
        }
      }

      self.$each();

      return result;
    
    };

    def.$inject = TMP_19 = function(object, sym) {
      var $a, self = this, $iter = TMP_19._p, block = $iter || nil;
      TMP_19._p = null;
      
      var result = object;

      if (block !== nil && sym === undefined) {
        self.$each._p = function() {
          var value = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = value;
            return;
          }

          value = $opal.$yieldX(block, [result, value]);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          result = value;
        };
      }
      else {
        if (sym === undefined) {
          if (!(($a = $scope.Symbol) == null ? $opal.cm('Symbol') : $a)['$==='](object)) {
            self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "" + (object.$inspect()) + " is not a Symbol");
          }

          sym    = object;
          result = undefined;
        }

        self.$each._p = function() {
          var value = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = value;
            return;
          }

          result = (result).$__send__(sym, value);
        };
      }

      self.$each();

      return result;
    ;
    };

    def.$lazy = function() {
      var $a, $b, TMP_20, $c, $d, self = this;
      return ($a = ($b = (($c = ((($d = $scope.Enumerator) == null ? $opal.cm('Enumerator') : $d))._scope).Lazy == null ? $c.cm('Lazy') : $c.Lazy)).$new, $a._p = (TMP_20 = function(enum$, args){var self = TMP_20._s || this, $a;if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
      return ($a = enum$).$yield.apply($a, [].concat(args))}, TMP_20._s = self, TMP_20), $a).call($b, self, self.$enumerator_size());
    };

    def.$enumerator_size = function() {
      var $a, self = this;
      if (($a = self['$respond_to?']("size")) !== false && $a !== nil) {
        return self.$size()
        } else {
        return nil
      };
    };

    self.$private("enumerator_size");

    $opal.defn(self, '$map', def.$collect);

    def.$max = TMP_21 = function() {
      var $a, self = this, $iter = TMP_21._p, block = $iter || nil;
      TMP_21._p = null;
      
      var result;

      if (block !== nil) {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          var value = block(param, result);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (value === nil) {
            self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison failed");
          }

          if (value > 0) {
            result = param;
          }
        };
      }
      else {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          if ((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$compare(param, result) > 0) {
            result = param;
          }
        };
      }

      self.$each();

      return result === undefined ? nil : result;
    
    };

    def.$max_by = TMP_22 = function() {
      var $a, self = this, $iter = TMP_22._p, block = $iter || nil;
      TMP_22._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("max_by")};
      
      var result,
          by;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (result === undefined) {
          result = param;
          by     = value;
          return;
        }

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((value)['$<=>'](by) > 0) {
          result = param
          by     = value;
        }
      };

      self.$each();

      return result === undefined ? nil : result;
    
    };

    $opal.defn(self, '$member?', def['$include?']);

    def.$min = TMP_23 = function() {
      var $a, self = this, $iter = TMP_23._p, block = $iter || nil;
      TMP_23._p = null;
      
      var result;

      if (block !== nil) {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          var value = block(param, result);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (value === nil) {
            self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison failed");
          }

          if (value < 0) {
            result = param;
          }
        };
      }
      else {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          if ((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$compare(param, result) < 0) {
            result = param;
          }
        };
      }

      self.$each();

      return result === undefined ? nil : result;
    
    };

    def.$min_by = TMP_24 = function() {
      var $a, self = this, $iter = TMP_24._p, block = $iter || nil;
      TMP_24._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("min_by")};
      
      var result,
          by;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (result === undefined) {
          result = param;
          by     = value;
          return;
        }

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((value)['$<=>'](by) < 0) {
          result = param
          by     = value;
        }
      };

      self.$each();

      return result === undefined ? nil : result;
    
    };

    def.$minmax = TMP_25 = function() {
      var $a, self = this, $iter = TMP_25._p, block = $iter || nil;
      TMP_25._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$minmax_by = TMP_26 = function() {
      var $a, self = this, $iter = TMP_26._p, block = $iter || nil;
      TMP_26._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def['$none?'] = TMP_27 = function() {
      var $a, self = this, $iter = TMP_27._p, block = $iter || nil;
      TMP_27._p = null;
      
      var result = true;

      if (block !== nil) {
        self.$each._p = function() {
          var value = $opal.$yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (($a = value) !== false && $a !== nil) {
            result = false;
            return $breaker;
          }
        }
      }
      else {
        self.$each._p = function() {
          var value = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (($a = value) !== false && $a !== nil) {
            result = false;
            return $breaker;
          }
        };
      }

      self.$each();

      return result;
    
    };

    def['$one?'] = TMP_28 = function() {
      var $a, self = this, $iter = TMP_28._p, block = $iter || nil;
      TMP_28._p = null;
      
      var result = false;

      if (block !== nil) {
        self.$each._p = function() {
          var value = $opal.$yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (($a = value) !== false && $a !== nil) {
            if (result === true) {
              result = false;
              return $breaker;
            }

            result = true;
          }
        }
      }
      else {
        self.$each._p = function() {
          var value = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (($a = value) !== false && $a !== nil) {
            if (result === true) {
              result = false;
              return $breaker;
            }

            result = true;
          }
        }
      }

      self.$each();

      return result;
    
    };

    def.$partition = TMP_29 = function() {
      var $a, self = this, $iter = TMP_29._p, block = $iter || nil;
      TMP_29._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    $opal.defn(self, '$reduce', def.$inject);

    def.$reverse_each = TMP_30 = function() {
      var $a, self = this, $iter = TMP_30._p, block = $iter || nil;
      TMP_30._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    $opal.defn(self, '$select', def.$find_all);

    def.$slice_before = TMP_31 = function(pattern) {
      var $a, $b, TMP_32, $c, self = this, $iter = TMP_31._p, block = $iter || nil;
      TMP_31._p = null;
      if (($a = pattern === undefined && block === nil || arguments.length > 1) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "wrong number of arguments (" + (arguments.length) + " for 1)")};
      return ($a = ($b = (($c = $scope.Enumerator) == null ? $opal.cm('Enumerator') : $c)).$new, $a._p = (TMP_32 = function(e){var self = TMP_32._s || this, $a;if (e == null) e = nil;
      
        var slice = [];

        if (block !== nil) {
          if (pattern === undefined) {
            self.$each._p = function() {
              var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
                  value = $opal.$yield1(block, param);

              if (($a = value) !== false && $a !== nil && slice.length > 0) {
                e['$<<'](slice);
                slice = [];
              }

              slice.push(param);
            };
          }
          else {
            self.$each._p = function() {
              var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
                  value = block(param, pattern.$dup());

              if (($a = value) !== false && $a !== nil && slice.length > 0) {
                e['$<<'](slice);
                slice = [];
              }

              slice.push(param);
            };
          }
        }
        else {
          self.$each._p = function() {
            var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
                value = pattern['$==='](param);

            if (($a = value) !== false && $a !== nil && slice.length > 0) {
              e['$<<'](slice);
              slice = [];
            }

            slice.push(param);
          };
        }

        self.$each();

        if (slice.length > 0) {
          e['$<<'](slice);
        }
      ;}, TMP_32._s = self, TMP_32), $a).call($b);
    };

    def.$sort = TMP_33 = function() {
      var $a, self = this, $iter = TMP_33._p, block = $iter || nil;
      TMP_33._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$sort_by = TMP_34 = function() {
      var $a, $b, TMP_35, $c, $d, TMP_36, $e, $f, TMP_37, self = this, $iter = TMP_34._p, block = $iter || nil;
      TMP_34._p = null;
      if (block === nil) {
        return self.$enum_for("sort_by")};
      return ($a = ($b = ($c = ($d = ($e = ($f = self).$map, $e._p = (TMP_37 = function(){var self = TMP_37._s || this, $a;
      arg = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);
        return [block.$call(arg), arg];}, TMP_37._s = self, TMP_37), $e).call($f)).$sort, $c._p = (TMP_36 = function(a, b){var self = TMP_36._s || this;if (a == null) a = nil;if (b == null) b = nil;
      return a['$[]'](0)['$<=>'](b['$[]'](0))}, TMP_36._s = self, TMP_36), $c).call($d)).$map, $a._p = (TMP_35 = function(arg){var self = TMP_35._s || this;if (arg == null) arg = nil;
      return arg[1];}, TMP_35._s = self, TMP_35), $a).call($b);
    };

    def.$take = function(num) {
      var self = this;
      return self.$first(num);
    };

    def.$take_while = TMP_38 = function() {
      var $a, self = this, $iter = TMP_38._p, block = $iter || nil;
      TMP_38._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("take_while")};
      
      var result = [];

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if (($a = value) === false || $a === nil) {
          return $breaker;
        }

        result.push(param);
      };

      self.$each();

      return result;
    
    };

    $opal.defn(self, '$to_a', def.$entries);

    def.$zip = TMP_39 = function(lists) {
      var $a, self = this, $iter = TMP_39._p, block = $iter || nil;
      lists = $slice.call(arguments, 0);
      TMP_39._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };
        ;$opal.donate(self, ["$all?", "$any?", "$chunk", "$collect", "$collect_concat", "$count", "$cycle", "$detect", "$drop", "$drop_while", "$each_cons", "$each_entry", "$each_slice", "$each_with_index", "$each_with_object", "$entries", "$find", "$find_all", "$find_index", "$first", "$flat_map", "$grep", "$group_by", "$include?", "$inject", "$lazy", "$enumerator_size", "$map", "$max", "$max_by", "$member?", "$min", "$min_by", "$minmax", "$minmax_by", "$none?", "$one?", "$partition", "$reduce", "$reverse_each", "$select", "$slice_before", "$sort", "$sort_by", "$take", "$take_while", "$to_a", "$zip"]);
  })(self)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/enumerable.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$include', '$allocate', '$new', '$to_proc', '$coerce_to', '$__send__', '$===', '$call', '$enum_for', '$destructure', '$name', '$class', '$inspect', '$empty?', '$+', '$[]', '$raise', '$yield', '$each', '$enumerator_size', '$respond_to?', '$try_convert', '$<', '$for']);
  return (function($base, $super) {
    function $Enumerator(){};
    var self = $Enumerator = $klass($base, $super, 'Enumerator', $Enumerator);

    var def = $Enumerator._proto, $scope = $Enumerator._scope, $a, TMP_1, TMP_2, TMP_3, TMP_4;
    def.size = def.object = def.method = def.args = nil;
    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    $opal.defs(self, '$for', TMP_1 = function(object, method, args) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;
      args = $slice.call(arguments, 2);
      if (method == null) {
        method = "each"
      }
      TMP_1._p = null;
      
      var obj = self.$allocate();

      obj.object = object;
      obj.size   = block;
      obj.method = method;
      obj.args   = args;

      return obj;
    ;
    });

    def.$initialize = TMP_2 = function() {
      var $a, $b, $c, self = this, $iter = TMP_2._p, block = $iter || nil;
      TMP_2._p = null;
      if (block !== false && block !== nil) {
        self.object = ($a = ($b = (($c = $scope.Generator) == null ? $opal.cm('Generator') : $c)).$new, $a._p = block.$to_proc(), $a).call($b);
        self.method = "each";
        self.args = [];
        self.size = arguments[0] || nil;
        if (($a = self.size) !== false && $a !== nil) {
          return self.size = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(self.size, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
          } else {
          return nil
        };
        } else {
        self.object = arguments[0];
        self.method = arguments[1] || "each";
        self.args = $slice.call(arguments, 2);
        return self.size = nil;
      };
    };

    def.$each = TMP_3 = function() {
      var $a, $b, self = this, $iter = TMP_3._p, block = $iter || nil;
      TMP_3._p = null;
      if (($a = block) === false || $a === nil) {
        return self};
      return ($a = ($b = self.object).$__send__, $a._p = block.$to_proc(), $a).apply($b, [self.method].concat(self.args));
    };

    def.$size = function() {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Proc) == null ? $opal.cm('Proc') : $b)['$==='](self.size)) !== false && $a !== nil) {
        return ($a = self.size).$call.apply($a, [].concat(self.args))
        } else {
        return self.size
      };
    };

    def.$with_index = TMP_4 = function(offset) {
      var $a, self = this, $iter = TMP_4._p, block = $iter || nil;
      if (offset == null) {
        offset = 0
      }
      TMP_4._p = null;
      if (offset !== false && offset !== nil) {
        offset = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(offset, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
        } else {
        offset = 0
      };
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("with_index", offset)};
      
      var result

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = block(param, index);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        index++;
      }

      self.$each();

      if (result !== undefined) {
        return result;
      }
    ;
    };

    $opal.defn(self, '$with_object', def.$each_with_object);

    def.$inspect = function() {
      var $a, self = this, result = nil;
      result = "#<" + (self.$class().$name()) + ": " + (self.object.$inspect()) + ":" + (self.method);
      if (($a = self.args['$empty?']()) === false || $a === nil) {
        result = result['$+']("(" + (self.args.$inspect()['$[]']((($a = $scope.Range) == null ? $opal.cm('Range') : $a).$new(1, -2))) + ")")};
      return result['$+'](">");
    };

    (function($base, $super) {
      function $Generator(){};
      var self = $Generator = $klass($base, $super, 'Generator', $Generator);

      var def = $Generator._proto, $scope = $Generator._scope, $a, TMP_5, TMP_6;
      def.block = nil;
      self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

      def.$initialize = TMP_5 = function() {
        var $a, self = this, $iter = TMP_5._p, block = $iter || nil;
        TMP_5._p = null;
        if (($a = block) === false || $a === nil) {
          self.$raise((($a = $scope.LocalJumpError) == null ? $opal.cm('LocalJumpError') : $a), "no block given")};
        return self.block = block;
      };

      return (def.$each = TMP_6 = function(args) {
        var $a, $b, $c, self = this, $iter = TMP_6._p, block = $iter || nil, yielder = nil;
        args = $slice.call(arguments, 0);
        TMP_6._p = null;
        yielder = ($a = ($b = (($c = $scope.Yielder) == null ? $opal.cm('Yielder') : $c)).$new, $a._p = block.$to_proc(), $a).call($b);
        
        try {
          args.unshift(yielder);

          if ($opal.$yieldX(self.block, args) === $breaker) {
            return $breaker.$v;
          }
        }
        catch (e) {
          if (e === $breaker) {
            return $breaker.$v;
          }
          else {
            throw e;
          }
        }
      ;
        return self;
      }, nil);
    })(self, null);

    (function($base, $super) {
      function $Yielder(){};
      var self = $Yielder = $klass($base, $super, 'Yielder', $Yielder);

      var def = $Yielder._proto, $scope = $Yielder._scope, TMP_7;
      def.block = nil;
      def.$initialize = TMP_7 = function() {
        var self = this, $iter = TMP_7._p, block = $iter || nil;
        TMP_7._p = null;
        return self.block = block;
      };

      def.$yield = function(values) {
        var self = this;
        values = $slice.call(arguments, 0);
        
        var value = $opal.$yieldX(self.block, values);

        if (value === $breaker) {
          throw $breaker;
        }

        return value;
      ;
      };

      return (def['$<<'] = function(values) {
        var $a, self = this;
        values = $slice.call(arguments, 0);
        ($a = self).$yield.apply($a, [].concat(values));
        return self;
      }, nil);
    })(self, null);

    return (function($base, $super) {
      function $Lazy(){};
      var self = $Lazy = $klass($base, $super, 'Lazy', $Lazy);

      var def = $Lazy._proto, $scope = $Lazy._scope, $a, TMP_8, TMP_11, TMP_13, TMP_18, TMP_20, TMP_21, TMP_23, TMP_26, TMP_29;
      def.enumerator = nil;
      (function($base, $super) {
        function $StopLazyError(){};
        var self = $StopLazyError = $klass($base, $super, 'StopLazyError', $StopLazyError);

        var def = $StopLazyError._proto, $scope = $StopLazyError._scope;
        return nil;
      })(self, (($a = $scope.Exception) == null ? $opal.cm('Exception') : $a));

      def.$initialize = TMP_8 = function(object, size) {
        var $a, TMP_9, self = this, $iter = TMP_8._p, block = $iter || nil;
        if (size == null) {
          size = nil
        }
        TMP_8._p = null;
        if (block === nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy new without a block")};
        self.enumerator = object;
        return $opal.find_super_dispatcher(self, 'initialize', TMP_8, (TMP_9 = function(yielder, each_args){var self = TMP_9._s || this, $a, $b, TMP_10;if (yielder == null) yielder = nil;each_args = $slice.call(arguments, 1);
        try {
          return ($a = ($b = object).$each, $a._p = (TMP_10 = function(args){var self = TMP_10._s || this;args = $slice.call(arguments, 0);
            
              args.unshift(yielder);

              if ($opal.$yieldX(block, args) === $breaker) {
                return $breaker;
              }
            ;}, TMP_10._s = self, TMP_10), $a).apply($b, [].concat(each_args))
          } catch ($err) {if ((($a = $scope.Exception) == null ? $opal.cm('Exception') : $a)['$===']($err)) {
            return nil
            }else { throw $err; }
          }}, TMP_9._s = self, TMP_9)).apply(self, [size]);
      };

      $opal.defn(self, '$force', def.$to_a);

      def.$lazy = function() {
        var self = this;
        return self;
      };

      def.$collect = TMP_11 = function() {
        var $a, $b, TMP_12, $c, self = this, $iter = TMP_11._p, block = $iter || nil;
        TMP_11._p = null;
        if (($a = block) === false || $a === nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy map without a block")};
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_12 = function(enum$, args){var self = TMP_12._s || this;if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = $opal.$yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          enum$.$yield(value);
        }, TMP_12._s = self, TMP_12), $a).call($b, self, self.$enumerator_size());
      };

      def.$collect_concat = TMP_13 = function() {
        var $a, $b, TMP_14, $c, self = this, $iter = TMP_13._p, block = $iter || nil;
        TMP_13._p = null;
        if (($a = block) === false || $a === nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy map without a block")};
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_14 = function(enum$, args){var self = TMP_14._s || this, $a, $b, TMP_15, $c, TMP_16;if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = $opal.$yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if ((value)['$respond_to?']("force") && (value)['$respond_to?']("each")) {
            ($a = ($b = (value)).$each, $a._p = (TMP_15 = function(v){var self = TMP_15._s || this;if (v == null) v = nil;
          return enum$.$yield(v)}, TMP_15._s = self, TMP_15), $a).call($b)
          }
          else {
            var array = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$try_convert(value, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary");

            if (array === nil) {
              enum$.$yield(value);
            }
            else {
              ($a = ($c = (value)).$each, $a._p = (TMP_16 = function(v){var self = TMP_16._s || this;if (v == null) v = nil;
          return enum$.$yield(v)}, TMP_16._s = self, TMP_16), $a).call($c);
            }
          }
        ;}, TMP_14._s = self, TMP_14), $a).call($b, self, nil);
      };

      def.$drop = function(n) {
        var $a, $b, TMP_17, $c, self = this, current_size = nil, set_size = nil, dropped = nil;
        n = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(n, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if (n['$<'](0)) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "attempt to drop negative size")};
        current_size = self.$enumerator_size();
        set_size = (function() {if (($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](current_size)) !== false && $a !== nil) {
          if (n['$<'](current_size)) {
            return n
            } else {
            return current_size
          }
          } else {
          return current_size
        }; return nil; })();
        dropped = 0;
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_17 = function(enum$, args){var self = TMP_17._s || this, $a;if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        if (dropped['$<'](n)) {
            return dropped = dropped['$+'](1)
            } else {
            return ($a = enum$).$yield.apply($a, [].concat(args))
          }}, TMP_17._s = self, TMP_17), $a).call($b, self, set_size);
      };

      def.$drop_while = TMP_18 = function() {
        var $a, $b, TMP_19, $c, self = this, $iter = TMP_18._p, block = $iter || nil, succeeding = nil;
        TMP_18._p = null;
        if (($a = block) === false || $a === nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy drop_while without a block")};
        succeeding = true;
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_19 = function(enum$, args){var self = TMP_19._s || this, $a, $b;if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        if (succeeding !== false && succeeding !== nil) {
            
            var value = $opal.$yieldX(block, args);

            if (value === $breaker) {
              return $breaker;
            }

            if (($a = value) === false || $a === nil) {
              succeeding = false;

              ($a = enum$).$yield.apply($a, [].concat(args));
            }
          
            } else {
            return ($b = enum$).$yield.apply($b, [].concat(args))
          }}, TMP_19._s = self, TMP_19), $a).call($b, self, nil);
      };

      def.$enum_for = TMP_20 = function(method, args) {
        var $a, $b, self = this, $iter = TMP_20._p, block = $iter || nil;
        args = $slice.call(arguments, 1);
        if (method == null) {
          method = "each"
        }
        TMP_20._p = null;
        return ($a = ($b = self.$class()).$for, $a._p = block.$to_proc(), $a).apply($b, [self, method].concat(args));
      };

      def.$find_all = TMP_21 = function() {
        var $a, $b, TMP_22, $c, self = this, $iter = TMP_21._p, block = $iter || nil;
        TMP_21._p = null;
        if (($a = block) === false || $a === nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy select without a block")};
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_22 = function(enum$, args){var self = TMP_22._s || this, $a;if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = $opal.$yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if (($a = value) !== false && $a !== nil) {
            ($a = enum$).$yield.apply($a, [].concat(args));
          }
        ;}, TMP_22._s = self, TMP_22), $a).call($b, self, nil);
      };

      $opal.defn(self, '$flat_map', def.$collect_concat);

      def.$grep = TMP_23 = function(pattern) {
        var $a, $b, TMP_24, $c, TMP_25, $d, self = this, $iter = TMP_23._p, block = $iter || nil;
        TMP_23._p = null;
        if (block !== false && block !== nil) {
          return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_24 = function(enum$, args){var self = TMP_24._s || this, $a;if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
          
            var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(args),
                value = pattern['$==='](param);

            if (($a = value) !== false && $a !== nil) {
              value = $opal.$yield1(block, param);

              if (value === $breaker) {
                return $breaker;
              }

              enum$.$yield($opal.$yield1(block, param));
            }
          ;}, TMP_24._s = self, TMP_24), $a).call($b, self, nil)
          } else {
          return ($a = ($c = (($d = $scope.Lazy) == null ? $opal.cm('Lazy') : $d)).$new, $a._p = (TMP_25 = function(enum$, args){var self = TMP_25._s || this, $a;if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
          
            var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(args),
                value = pattern['$==='](param);

            if (($a = value) !== false && $a !== nil) {
              enum$.$yield(param);
            }
          ;}, TMP_25._s = self, TMP_25), $a).call($c, self, nil)
        };
      };

      $opal.defn(self, '$map', def.$collect);

      $opal.defn(self, '$select', def.$find_all);

      def.$reject = TMP_26 = function() {
        var $a, $b, TMP_27, $c, self = this, $iter = TMP_26._p, block = $iter || nil;
        TMP_26._p = null;
        if (($a = block) === false || $a === nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy reject without a block")};
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_27 = function(enum$, args){var self = TMP_27._s || this, $a;if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = $opal.$yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if (($a = value) === false || $a === nil) {
            ($a = enum$).$yield.apply($a, [].concat(args));
          }
        ;}, TMP_27._s = self, TMP_27), $a).call($b, self, nil);
      };

      def.$take = function(n) {
        var $a, $b, TMP_28, $c, self = this, current_size = nil, set_size = nil, taken = nil;
        n = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(n, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if (n['$<'](0)) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "attempt to take negative size")};
        current_size = self.$enumerator_size();
        set_size = (function() {if (($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](current_size)) !== false && $a !== nil) {
          if (n['$<'](current_size)) {
            return n
            } else {
            return current_size
          }
          } else {
          return current_size
        }; return nil; })();
        taken = 0;
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_28 = function(enum$, args){var self = TMP_28._s || this, $a, $b;if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        if (taken['$<'](n)) {
            ($a = enum$).$yield.apply($a, [].concat(args));
            return taken = taken['$+'](1);
            } else {
            return self.$raise((($b = $scope.StopLazyError) == null ? $opal.cm('StopLazyError') : $b))
          }}, TMP_28._s = self, TMP_28), $a).call($b, self, set_size);
      };

      def.$take_while = TMP_29 = function() {
        var $a, $b, TMP_30, $c, self = this, $iter = TMP_29._p, block = $iter || nil;
        TMP_29._p = null;
        if (($a = block) === false || $a === nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy take_while without a block")};
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_30 = function(enum$, args){var self = TMP_30._s || this, $a, $b;if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = $opal.$yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if (($a = value) !== false && $a !== nil) {
            ($a = enum$).$yield.apply($a, [].concat(args));
          }
          else {
            self.$raise((($b = $scope.StopLazyError) == null ? $opal.cm('StopLazyError') : $b));
          }
        ;}, TMP_30._s = self, TMP_30), $a).call($b, self, nil);
      };

      $opal.defn(self, '$to_enum', def.$enum_for);

      return (def.$inspect = function() {
        var self = this;
        return "#<" + (self.$class().$name()) + ": " + (self.enumerator.$inspect()) + ">";
      }, nil);
    })(self, self);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/enumerator.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $range = $opal.range;
  $opal.add_stubs(['$include', '$new', '$class', '$raise', '$===', '$to_a', '$respond_to?', '$to_ary', '$coerce_to', '$==', '$to_str', '$clone', '$hash', '$<=>', '$fits_fixnum!', '$inspect', '$empty?', '$enum_for', '$nil?', '$coerce_to!', '$initialize_clone', '$initialize_dup', '$replace', '$eql?', '$length', '$begin', '$end', '$exclude_end?', '$fits_array!', '$flatten', '$object_id', '$[]', '$to_s', '$delete_if', '$to_proc', '$each', '$reverse', '$map', '$rand', '$keep_if', '$shuffle!', '$>', '$<', '$sort', '$times', '$[]=', '$<<', '$at', '$allocate', '$initialize', '$__send__', '$*', '$slice', '$uniq']);
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = $Array._proto, $scope = $Array._scope, $a, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12, TMP_13, TMP_14, TMP_15, TMP_17, TMP_18, TMP_19, TMP_20, TMP_21, TMP_24;
    def.length = nil;
    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    def._isArray = true;

    $opal.defs(self, '$inherited', function(klass) {
      var $a, $b, self = this, replace = nil;
      replace = (($a = $scope.Class) == null ? $opal.cm('Class') : $a).$new((($a = ((($b = $scope.Array) == null ? $opal.cm('Array') : $b))._scope).Wrapper == null ? $a.cm('Wrapper') : $a.Wrapper));
      
      klass._proto        = replace._proto;
      klass._proto._klass = klass;
      klass._alloc        = replace._alloc;
      klass.__parent      = (($a = ((($b = $scope.Array) == null ? $opal.cm('Array') : $b))._scope).Wrapper == null ? $a.cm('Wrapper') : $a.Wrapper);

      klass.$allocate = replace.$allocate;
      klass.$new      = replace.$new;
      klass["$[]"]    = replace["$[]"];
    
    });

    $opal.defs(self, '$[]', function(objects) {
      var self = this;
      objects = $slice.call(arguments, 0);
      return objects;
    });

    def.$initialize = function(args) {
      var $a, self = this;
      args = $slice.call(arguments, 0);
      return ($a = self.$class()).$new.apply($a, [].concat(args));
    };

    $opal.defs(self, '$new', TMP_1 = function(size, obj) {
      var $a, $b, self = this, $iter = TMP_1._p, block = $iter || nil;
      if (size == null) {
        size = nil
      }
      if (obj == null) {
        obj = nil
      }
      TMP_1._p = null;
      if (($a = arguments.length > 2) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "wrong number of arguments (" + (arguments.length) + " for 0..2)")};
      if (($a = arguments.length === 0) !== false && $a !== nil) {
        return []};
      if (($a = arguments.length === 1) !== false && $a !== nil) {
        if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](size)) !== false && $a !== nil) {
          return size.$to_a()
        } else if (($a = size['$respond_to?']("to_ary")) !== false && $a !== nil) {
          return size.$to_ary()}};
      size = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(size, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      if (($a = size < 0) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "negative array size")};
      
      var result = [];

      if (block === nil) {
        for (var i = 0; i < size; i++) {
          result.push(obj);
        }
      }
      else {
        for (var i = 0, value; i < size; i++) {
          value = block(i);

          if (value === $breaker) {
            return $breaker.$v;
          }

          result[i] = value;
        }
      }

      return result;
    
    });

    $opal.defs(self, '$try_convert', function(obj) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](obj)) !== false && $a !== nil) {
        return obj};
      if (($a = obj['$respond_to?']("to_ary")) !== false && $a !== nil) {
        return obj.$to_ary()};
      return nil;
    });

    def['$&'] = function(other) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== false && $a !== nil) {
        other = other.$to_a()
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
      };
      
      var result = [],
          seen   = {};

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if (!seen[item]) {
          for (var j = 0, length2 = other.length; j < length2; j++) {
            var item2 = other[j];

            if (!seen[item2] && (item)['$=='](item2)) {
              seen[item] = true;
              result.push(item);
            }
          }
        }
      }

      return result;
    
    };

    def['$*'] = function(other) {
      var $a, self = this;
      if (($a = other['$respond_to?']("to_str")) !== false && $a !== nil) {
        return self.join(other.$to_str())};
      if (($a = other['$respond_to?']("to_int")) === false || $a === nil) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "no implicit conversion of " + (other.$class()) + " into Integer")};
      other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      if (($a = other < 0) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "negative argument")};
      
      var result = [];

      for (var i = 0; i < other; i++) {
        result = result.concat(self);
      }

      return result;
    
    };

    def['$+'] = function(other) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== false && $a !== nil) {
        other = other.$to_a()
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
      };
      return self.concat(other);
    };

    def['$-'] = function(other) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== false && $a !== nil) {
        other = other.$to_a()
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
      };
      if (($a = self.length === 0) !== false && $a !== nil) {
        return []};
      if (($a = other.length === 0) !== false && $a !== nil) {
        return self.$clone()};
      
      var seen   = {},
          result = [];

      for (var i = 0, length = other.length; i < length; i++) {
        seen[other[i]] = true;
      }

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if (!seen[item]) {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$<<'] = function(object) {
      var self = this;
      self.push(object);
      return self;
    };

    def['$<=>'] = function(other) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== false && $a !== nil) {
        other = other.$to_a()
      } else if (($a = other['$respond_to?']("to_ary")) !== false && $a !== nil) {
        other = other.$to_ary().$to_a()
        } else {
        return nil
      };
      
      if (self.$hash() === other.$hash()) {
        return 0;
      }

      if (self.length != other.length) {
        return (self.length > other.length) ? 1 : -1;
      }

      for (var i = 0, length = self.length; i < length; i++) {
        var tmp = (self[i])['$<=>'](other[i]);

        if (tmp !== 0) {
          return tmp;
        }
      }

      return 0;
    ;
    };

    def['$=='] = function(other) {
      var $a, $b, self = this;
      if (($a = self === other) !== false && $a !== nil) {
        return true};
      if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) === false || $a === nil) {
        if (($a = other['$respond_to?']("to_ary")) === false || $a === nil) {
          return false};
        return other['$=='](self);};
      other = other.$to_a();
      if (($a = self.length === other.length) === false || $a === nil) {
        return false};
      
      for (var i = 0, length = self.length; i < length; i++) {
        var a = self[i],
            b = other[i];

        if (a._isArray && b._isArray && (a === self)) {
          continue;
        }

        if (!(a)['$=='](b)) {
          return false;
        }
      }
    
      return true;
    };

    def['$[]'] = function(index, length) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Range) == null ? $opal.cm('Range') : $b)['$==='](index)) !== false && $a !== nil) {
        
        var size    = self.length,
            exclude = index.exclude,
            from    = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index.begin, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int"),
            to      = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index.end, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

        if (from < 0) {
          from += size;

          if (from < 0) {
            return nil;
          }
        }

        (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$fits_fixnum!'](from);

        if (from > size) {
          return nil;
        }

        if (to < 0) {
          to += size;

          if (to < 0) {
            return [];
          }
        }

        (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$fits_fixnum!'](to);

        if (!exclude) {
          to += 1;
        }

        return self.slice(from, to);
      ;
        } else {
        index = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        
        var size = self.length;

        if (index < 0) {
          index += size;

          if (index < 0) {
            return nil;
          }
        }

        (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$fits_fixnum!'](index);

        if (length === undefined) {
          if (index >= size || index < 0) {
            return nil;
          }

          return self[index];
        }
        else {
          length = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(length, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

          (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$fits_fixnum!'](length);

          if (length < 0 || index > size || index < 0) {
            return nil;
          }

          return self.slice(index, index + length);
        }
      
      };
    };

    def['$[]='] = function(index, value, extra) {
      var $a, $b, self = this, data = nil, length = nil;
      if (($a = (($b = $scope.Range) == null ? $opal.cm('Range') : $b)['$==='](index)) !== false && $a !== nil) {
        if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](value)) !== false && $a !== nil) {
          data = value.$to_a()
        } else if (($a = value['$respond_to?']("to_ary")) !== false && $a !== nil) {
          data = value.$to_ary().$to_a()
          } else {
          data = [value]
        };
        
        var size    = self.length,
            exclude = index.exclude,
            from    = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index.begin, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int"),
            to      = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index.end, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

        if (from < 0) {
          from += size;

          if (from < 0) {
            self.$raise((($a = $scope.RangeError) == null ? $opal.cm('RangeError') : $a), "" + (index.$inspect()) + " out of range");
          }
        }

        (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$fits_fixnum!'](from);

        if (to < 0) {
          to += size;
        }

        (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$fits_fixnum!'](to);

        if (!exclude) {
          to += 1;
        }

        if (from > size) {
          for (var i = size; i < index; i++) {
            self[i] = nil;
          }
        }

        if (to < 0) {
          self.splice.apply(self, [from, 0].concat(data));
        }
        else {
          self.splice.apply(self, [from, to - from].concat(data));
        }

        return value;
      ;
        } else {
        if (($a = extra === undefined) !== false && $a !== nil) {
          length = 1
          } else {
          length = value;
          value = extra;
          if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](value)) !== false && $a !== nil) {
            data = value.$to_a()
          } else if (($a = value['$respond_to?']("to_ary")) !== false && $a !== nil) {
            data = value.$to_ary().$to_a()
            } else {
            data = [value]
          };
        };
        
        var size   = self.length,
            index  = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int"),
            length = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(length, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int"),
            old;

        if (index < 0) {
          old    = index;
          index += size;

          if (index < 0) {
            self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "index " + (old) + " too small for array; minimum " + (-self.length));
          }
        }

        (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$fits_fixnum!'](index);

        if (length < 0) {
          self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "negative length (" + (length) + ")")
        }

        (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$fits_fixnum!'](length);

        if (index > size) {
          for (var i = size; i < index; i++) {
            self[i] = nil;
          }
        }

        if (extra === undefined) {
          self[index] = value;
        }
        else {
          self.splice.apply(self, [index, length].concat(data));
        }

        return value;
      ;
      };
    };

    def.$assoc = function(object) {
      var self = this;
      
      for (var i = 0, length = self.length, item; i < length; i++) {
        if (item = self[i], item.length && (item[0])['$=='](object)) {
          return item;
        }
      }

      return nil;
    
    };

    def.$at = function(index) {
      var $a, self = this;
      index = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      
      if (index < 0) {
        index += self.length;
      }

      if (index < 0 || index >= self.length) {
        return nil;
      }

      return self[index];
    
    };

    def.$cycle = TMP_2 = function(n) {
      var $a, $b, self = this, $iter = TMP_2._p, block = $iter || nil;
      if (n == null) {
        n = nil
      }
      TMP_2._p = null;
      if (($a = ((($b = self['$empty?']()) !== false && $b !== nil) ? $b : n['$=='](0))) !== false && $a !== nil) {
        return nil};
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("cycle", n)};
      if (($a = n['$nil?']()) !== false && $a !== nil) {
        
        while (true) {
          for (var i = 0, length = self.length; i < length; i++) {
            var value = $opal.$yield1(block, self[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }
        }
      
        } else {
        n = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](n, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        
        if (n <= 0) {
          return self;
        }

        while (n > 0) {
          for (var i = 0, length = self.length; i < length; i++) {
            var value = $opal.$yield1(block, self[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }

          n--;
        }
      
      };
      return self;
    };

    def.$clear = function() {
      var self = this;
      self.splice(0, self.length);
      return self;
    };

    def.$clone = function() {
      var self = this, copy = nil;
      copy = [];
      copy.$initialize_clone(self);
      return copy;
    };

    def.$dup = function() {
      var self = this, copy = nil;
      copy = [];
      copy.$initialize_dup(self);
      return copy;
    };

    def.$initialize_copy = function(other) {
      var self = this;
      return self.$replace(other);
    };

    def.$collect = TMP_3 = function() {
      var self = this, $iter = TMP_3._p, block = $iter || nil;
      TMP_3._p = null;
      if (block === nil) {
        return self.$enum_for("collect")};
      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var value = Opal.$yield1(block, self[i]);

        if (value === $breaker) {
          return $breaker.$v;
        }

        result.push(value);
      }

      return result;
    
    };

    def['$collect!'] = TMP_4 = function() {
      var self = this, $iter = TMP_4._p, block = $iter || nil;
      TMP_4._p = null;
      if (block === nil) {
        return self.$enum_for("collect!")};
      
      for (var i = 0, length = self.length; i < length; i++) {
        var value = Opal.$yield1(block, self[i]);

        if (value === $breaker) {
          return $breaker.$v;
        }

        self[i] = value;
      }
    
      return self;
    };

    def.$compact = function() {
      var self = this;
      
      var result = [];

      for (var i = 0, length = self.length, item; i < length; i++) {
        if ((item = self[i]) !== nil) {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$compact!'] = function() {
      var self = this;
      
      var original = self.length;

      for (var i = 0, length = self.length; i < length; i++) {
        if (self[i] === nil) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }

      return self.length === original ? nil : self;
    
    };

    def.$concat = function(other) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== false && $a !== nil) {
        other = other.$to_a()
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
      };
      
      for (var i = 0, length = other.length; i < length; i++) {
        self.push(other[i]);
      }
    
      return self;
    };

    def.$delete = function(object) {
      var self = this;
      
      var original = self.length;

      for (var i = 0, length = original; i < length; i++) {
        if ((self[i])['$=='](object)) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }

      return self.length === original ? nil : object;
    
    };

    def.$delete_at = function(index) {
      var self = this;
      
      if (index < 0) {
        index += self.length;
      }

      if (index < 0 || index >= self.length) {
        return nil;
      }

      var result = self[index];

      self.splice(index, 1);

      return result;
    
    };

    def.$delete_if = TMP_5 = function() {
      var self = this, $iter = TMP_5._p, block = $iter || nil;
      TMP_5._p = null;
      if (block === nil) {
        return self.$enum_for("delete_if")};
      
      for (var i = 0, length = self.length, value; i < length; i++) {
        if ((value = block(self[i])) === $breaker) {
          return $breaker.$v;
        }

        if (value !== false && value !== nil) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }
    
      return self;
    };

    def.$drop = function(number) {
      var $a, self = this;
      
      if (number < 0) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a))
      }

      return self.slice(number);
    ;
    };

    $opal.defn(self, '$dup', def.$clone);

    def.$each = TMP_6 = function() {
      var self = this, $iter = TMP_6._p, block = $iter || nil;
      TMP_6._p = null;
      if (block === nil) {
        return self.$enum_for("each")};
      
      for (var i = 0, length = self.length; i < length; i++) {
        var value = $opal.$yield1(block, self[i]);

        if (value == $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def.$each_index = TMP_7 = function() {
      var self = this, $iter = TMP_7._p, block = $iter || nil;
      TMP_7._p = null;
      if (block === nil) {
        return self.$enum_for("each_index")};
      
      for (var i = 0, length = self.length; i < length; i++) {
        var value = $opal.$yield1(block, i);

        if (value === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def['$empty?'] = function() {
      var self = this;
      return self.length === 0;
    };

    def['$eql?'] = function(other) {
      var $a, $b, self = this;
      if (($a = self === other) !== false && $a !== nil) {
        return true};
      if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) === false || $a === nil) {
        return false};
      other = other.$to_a();
      if (($a = self.length === other.length) === false || $a === nil) {
        return false};
      
      for (var i = 0, length = self.length; i < length; i++) {
        var a = self[i],
            b = other[i];

        if (a._isArray && b._isArray && (a === self)) {
          continue;
        }

        if (!(a)['$eql?'](b)) {
          return false;
        }
      }
    
      return true;
    };

    def.$fetch = TMP_8 = function(index, defaults) {
      var $a, self = this, $iter = TMP_8._p, block = $iter || nil;
      TMP_8._p = null;
      
      var original = index;

      if (index < 0) {
        index += self.length;
      }

      if (index >= 0 && index < self.length) {
        return self[index];
      }

      if (block !== nil) {
        return block(original);
      }

      if (defaults != null) {
        return defaults;
      }

      if (self.length === 0) {
        self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "index " + (original) + " outside of array bounds: 0...0")
      }
      else {
        self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "index " + (original) + " outside of array bounds: -" + (self.length) + "..." + (self.length));
      }
    ;
    };

    def.$fill = TMP_9 = function(args) {
      var $a, $b, self = this, $iter = TMP_9._p, block = $iter || nil, one = nil, two = nil, obj = nil, left = nil, right = nil;
      args = $slice.call(arguments, 0);
      TMP_9._p = null;
      if (block !== false && block !== nil) {
        if (($a = args.length > 2) !== false && $a !== nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "wrong number of arguments (" + (args.$length()) + " for 0..2)")};
        $a = $opal.to_ary(args), one = ($a[0] == null ? nil : $a[0]), two = ($a[1] == null ? nil : $a[1]);
        } else {
        if (($a = args.length == 0) !== false && $a !== nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "wrong number of arguments (0 for 1..3)")
        } else if (($a = args.length > 3) !== false && $a !== nil) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "wrong number of arguments (" + (args.$length()) + " for 1..3)")};
        $a = $opal.to_ary(args), obj = ($a[0] == null ? nil : $a[0]), one = ($a[1] == null ? nil : $a[1]), two = ($a[2] == null ? nil : $a[2]);
      };
      if (($a = (($b = $scope.Range) == null ? $opal.cm('Range') : $b)['$==='](one)) !== false && $a !== nil) {
        if (two !== false && two !== nil) {
          self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "length invalid with range")};
        left = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(one.$begin(), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if (($a = left < 0) !== false && $a !== nil) {
          left += self.length;};
        if (($a = left < 0) !== false && $a !== nil) {
          self.$raise((($a = $scope.RangeError) == null ? $opal.cm('RangeError') : $a), "" + (one.$inspect()) + " out of range")};
        right = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(one.$end(), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if (($a = right < 0) !== false && $a !== nil) {
          right += self.length;};
        if (($a = one['$exclude_end?']()) === false || $a === nil) {
          right += 1;};
        if (($a = right <= left) !== false && $a !== nil) {
          return self};
      } else if (one !== false && one !== nil) {
        left = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(one, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if (($a = left < 0) !== false && $a !== nil) {
          left += self.length;};
        if (($a = left < 0) !== false && $a !== nil) {
          left = 0};
        if (two !== false && two !== nil) {
          right = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(two, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
          if (($a = right == 0) !== false && $a !== nil) {
            return self};
          right += left;
          } else {
          right = self.length
        };
        } else {
        left = 0;
        right = self.length;
      };
      (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$fits_fixnum!'](right);
      (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$fits_array!'](right);
      if (($a = left > self.length) !== false && $a !== nil) {
        
        for (var i = self.length; i < right; i++) {
          self[i] = nil;
        }
      ;};
      if (($a = right > self.length) !== false && $a !== nil) {
        self.length = right};
      if (block !== false && block !== nil) {
        
        for (var length = self.length; left < right; left++) {
          var value = block(left);

          if (value === $breaker) {
            return $breaker.$v;
          }

          self[left] = value;
        }
      ;
        } else {
        
        for (var length = self.length; left < right; left++) {
          self[left] = obj;
        }
      ;
      };
      return self;
    };

    def.$first = function(count) {
      var $a, self = this;
      
      if (count != null) {

        if (count < 0) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a));
        }

        return self.slice(0, count);
      }

      return self.length === 0 ? nil : self[0];
    ;
    };

    def.$flatten = function(level) {
      var self = this;
      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if ((item)['$respond_to?']("to_ary")) {
          item = (item).$to_ary();

          if (level == null) {
            result.push.apply(result, (item).$flatten().$to_a());
          }
          else if (level == 0) {
            result.push(item);
          }
          else {
            result.push.apply(result, (item).$flatten(level - 1).$to_a());
          }
        }
        else {
          result.push(item);
        }
      }

      return result;
    ;
    };

    def['$flatten!'] = function(level) {
      var self = this;
      
      var flattened = self.$flatten(level);

      if (self.length == flattened.length) {
        for (var i = 0, length = self.length; i < length; i++) {
          if (self[i] !== flattened[i]) {
            break;
          }
        }

        if (i == length) {
          return nil;
        }
      }

      self.$replace(flattened);
    ;
      return self;
    };

    def.$hash = function() {
      var self = this;
      return self._id || (self._id = Opal.uid());
    };

    def['$include?'] = function(member) {
      var self = this;
      
      for (var i = 0, length = self.length; i < length; i++) {
        if ((self[i])['$=='](member)) {
          return true;
        }
      }

      return false;
    
    };

    def.$index = TMP_10 = function(object) {
      var self = this, $iter = TMP_10._p, block = $iter || nil;
      TMP_10._p = null;
      
      if (object != null) {
        for (var i = 0, length = self.length; i < length; i++) {
          if ((self[i])['$=='](object)) {
            return i;
          }
        }
      }
      else if (block !== nil) {
        for (var i = 0, length = self.length, value; i < length; i++) {
          if ((value = block(self[i])) === $breaker) {
            return $breaker.$v;
          }

          if (value !== false && value !== nil) {
            return i;
          }
        }
      }
      else {
        return self.$enum_for("index");
      }

      return nil;
    
    };

    def.$insert = function(index, objects) {
      var $a, self = this;
      objects = $slice.call(arguments, 1);
      
      if (objects.length > 0) {
        if (index < 0) {
          index += self.length + 1;

          if (index < 0) {
            self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "" + (index) + " is out of bounds");
          }
        }
        if (index > self.length) {
          for (var i = self.length; i < index; i++) {
            self.push(nil);
          }
        }

        self.splice.apply(self, [index, 0].concat(objects));
      }
    
      return self;
    };

    def.$inspect = function() {
      var self = this;
      
      var i, inspect, el, el_insp, length, object_id;

      inspect = [];
      object_id = self.$object_id();
      length = self.length;

      for (i = 0; i < length; i++) {
        el = self['$[]'](i);

        // Check object_id to ensure it's not the same array get into an infinite loop
        el_insp = (el).$object_id() === object_id ? '[...]' : (el).$inspect();

        inspect.push(el_insp);
      }
      return '[' + inspect.join(', ') + ']';
    ;
    };

    def.$join = function(sep) {
      var self = this;
      if (sep == null) {
        sep = ""
      }
      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        result.push((self[i]).$to_s());
      }

      return result.join(sep);
    
    };

    def.$keep_if = TMP_11 = function() {
      var self = this, $iter = TMP_11._p, block = $iter || nil;
      TMP_11._p = null;
      if (block === nil) {
        return self.$enum_for("keep_if")};
      
      for (var i = 0, length = self.length, value; i < length; i++) {
        if ((value = block(self[i])) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }
    
      return self;
    };

    def.$last = function(count) {
      var $a, self = this;
      
      var length = self.length;

      if (count === nil || typeof(count) == 'string') {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "no implicit conversion to integer");
      }

      if (typeof(count) == 'object') {
        if (count['$respond_to?']("to_int")) {
          count = count['$to_int']();
        }
        else {
          self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "no implicit conversion to integer");
        }
      }

      if (count == null) {
        return length === 0 ? nil : self[length - 1];
      }
      else if (count < 0) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "negative count given");
      }

      if (count > length) {
        count = length;
      }

      return self.slice(length - count, length);
    
    };

    def.$length = function() {
      var self = this;
      return self.length;
    };

    $opal.defn(self, '$map', def.$collect);

    $opal.defn(self, '$map!', def['$collect!']);

    def.$pop = function(count) {
      var $a, self = this;
      
      var length = self.length;

      if (count == null) {
        return length === 0 ? nil : self.pop();
      }

      if (count < 0) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "negative count given");
      }

      return count > length ? self.splice(0, self.length) : self.splice(length - count, length);
    
    };

    def.$push = function(objects) {
      var self = this;
      objects = $slice.call(arguments, 0);
      
      for (var i = 0, length = objects.length; i < length; i++) {
        self.push(objects[i]);
      }
    
      return self;
    };

    def.$rassoc = function(object) {
      var self = this;
      
      for (var i = 0, length = self.length, item; i < length; i++) {
        item = self[i];

        if (item.length && item[1] !== undefined) {
          if ((item[1])['$=='](object)) {
            return item;
          }
        }
      }

      return nil;
    
    };

    def.$reject = TMP_12 = function() {
      var self = this, $iter = TMP_12._p, block = $iter || nil;
      TMP_12._p = null;
      if (block === nil) {
        return self.$enum_for("reject")};
      
      var result = [];

      for (var i = 0, length = self.length, value; i < length; i++) {
        if ((value = block(self[i])) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          result.push(self[i]);
        }
      }
      return result;
    
    };

    def['$reject!'] = TMP_13 = function() {
      var $a, $b, self = this, $iter = TMP_13._p, block = $iter || nil;
      TMP_13._p = null;
      if (block === nil) {
        return self.$enum_for("reject!")};
      
      var original = self.length;
      ($a = ($b = self).$delete_if, $a._p = block.$to_proc(), $a).call($b);
      return self.length === original ? nil : self;
    
    };

    def.$replace = function(other) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== false && $a !== nil) {
        other = other.$to_a()
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
      };
      
      self.splice(0, self.length);
      self.push.apply(self, other);
    
      return self;
    };

    def.$reverse = function() {
      var self = this;
      return self.slice(0).reverse();
    };

    def['$reverse!'] = function() {
      var self = this;
      return self.reverse();
    };

    def.$reverse_each = TMP_14 = function() {
      var $a, $b, self = this, $iter = TMP_14._p, block = $iter || nil;
      TMP_14._p = null;
      if (block === nil) {
        return self.$enum_for("reverse_each")};
      ($a = ($b = self.$reverse()).$each, $a._p = block.$to_proc(), $a).call($b);
      return self;
    };

    def.$rindex = TMP_15 = function(object) {
      var self = this, $iter = TMP_15._p, block = $iter || nil;
      TMP_15._p = null;
      
      if (object != null) {
        for (var i = self.length - 1; i >= 0; i--) {
          if ((self[i])['$=='](object)) {
            return i;
          }
        }
      }
      else if (block !== nil) {
        for (var i = self.length - 1, value; i >= 0; i--) {
          if ((value = block(self[i])) === $breaker) {
            return $breaker.$v;
          }

          if (value !== false && value !== nil) {
            return i;
          }
        }
      }
      else if (object == null) {
        return self.$enum_for("rindex");
      }

      return nil;
    
    };

    def.$sample = function(n) {
      var $a, $b, $c, TMP_16, self = this;
      if (n == null) {
        n = nil
      }
      if (($a = ($b = ($c = n, ($c === nil || $c === false)), $b !== false && $b !== nil ?self['$empty?']() : $b)) !== false && $a !== nil) {
        return nil};
      if (($a = (($b = n !== false && n !== nil) ? self['$empty?']() : $b)) !== false && $a !== nil) {
        return []};
      if (n !== false && n !== nil) {
        return ($a = ($b = ($range(1, n, false))).$map, $a._p = (TMP_16 = function(){var self = TMP_16._s || this;
        return self['$[]'](self.$rand(self.$length()))}, TMP_16._s = self, TMP_16), $a).call($b)
        } else {
        return self['$[]'](self.$rand(self.$length()))
      };
    };

    def.$select = TMP_17 = function() {
      var self = this, $iter = TMP_17._p, block = $iter || nil;
      TMP_17._p = null;
      if (block === nil) {
        return self.$enum_for("select")};
      
      var result = [];

      for (var i = 0, length = self.length, item, value; i < length; i++) {
        item = self[i];

        if ((value = $opal.$yield1(block, item)) === $breaker) {
          return $breaker.$v;
        }

        if (value !== false && value !== nil) {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$select!'] = TMP_18 = function() {
      var $a, $b, self = this, $iter = TMP_18._p, block = $iter || nil;
      TMP_18._p = null;
      if (block === nil) {
        return self.$enum_for("select!")};
      
      var original = self.length;
      ($a = ($b = self).$keep_if, $a._p = block.$to_proc(), $a).call($b);
      return self.length === original ? nil : self;
    
    };

    def.$shift = function(count) {
      var self = this;
      
      if (self.length === 0) {
        return nil;
      }

      return count == null ? self.shift() : self.splice(0, count)
    
    };

    $opal.defn(self, '$size', def.$length);

    def.$shuffle = function() {
      var self = this;
      return self.$clone()['$shuffle!']();
    };

    def['$shuffle!'] = function() {
      var self = this;
      
      for (var i = self.length - 1; i > 0; i--) {
        var tmp = self[i],
            j   = Math.floor(Math.random() * (i + 1));

        self[i] = self[j];
        self[j] = tmp;
      }
    
      return self;
    };

    $opal.defn(self, '$slice', def['$[]']);

    def['$slice!'] = function(index, length) {
      var self = this;
      
      if (index < 0) {
        index += self.length;
      }

      if (length != null) {
        return self.splice(index, length);
      }

      if (index < 0 || index >= self.length) {
        return nil;
      }

      return self.splice(index, 1)[0];
    
    };

    def.$sort = TMP_19 = function() {
      var $a, self = this, $iter = TMP_19._p, block = $iter || nil;
      TMP_19._p = null;
      if (($a = self.length > 1) === false || $a === nil) {
        return self};
      
      if (!(block !== nil)) {
        block = function(a, b) {
          return (a)['$<=>'](b);
        };
      }

      try {
        return self.slice().sort(function(x, y) {
          var ret = block(x, y);

          if (ret === $breaker) {
            throw $breaker;
          }
          else if (ret === nil) {
            self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + ((x).$inspect()) + " with " + ((y).$inspect()) + " failed");
          }

          return (ret)['$>'](0) ? 1 : ((ret)['$<'](0) ? -1 : 0);
        });
      }
      catch (e) {
        if (e === $breaker) {
          return $breaker.$v;
        }
        else {
          throw e;
        }
      }
    ;
    };

    def['$sort!'] = TMP_20 = function() {
      var $a, $b, self = this, $iter = TMP_20._p, block = $iter || nil;
      TMP_20._p = null;
      
      var result;

      if ((block !== nil)) {
        result = ($a = ($b = (self.slice())).$sort, $a._p = block.$to_proc(), $a).call($b);
      }
      else {
        result = (self.slice()).$sort();
      }

      self.length = 0;
      for(var i = 0, length = result.length; i < length; i++) {
        self.push(result[i]);
      }

      return self;
    ;
    };

    def.$take = function(count) {
      var $a, self = this;
      
      if (count < 0) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a));
      }

      return self.slice(0, count);
    ;
    };

    def.$take_while = TMP_21 = function() {
      var self = this, $iter = TMP_21._p, block = $iter || nil;
      TMP_21._p = null;
      
      var result = [];

      for (var i = 0, length = self.length, item, value; i < length; i++) {
        item = self[i];

        if ((value = block(item)) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          return result;
        }

        result.push(item);
      }

      return result;
    
    };

    def.$to_a = function() {
      var self = this;
      return self;
    };

    $opal.defn(self, '$to_ary', def.$to_a);

    $opal.defn(self, '$to_s', def.$inspect);

    def.$transpose = function() {
      var $a, $b, TMP_22, self = this, result = nil, max = nil;
      if (($a = self['$empty?']()) !== false && $a !== nil) {
        return []};
      result = [];
      max = nil;
      ($a = ($b = self).$each, $a._p = (TMP_22 = function(row){var self = TMP_22._s || this, $a, $b, TMP_23;if (row == null) row = nil;
      if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](row)) !== false && $a !== nil) {
          row = row.$to_a()
          } else {
          row = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(row, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
        };
        ((($a = max) !== false && $a !== nil) ? $a : max = row.length);
        if (($a = ($b = (row.length)['$=='](max), ($b === nil || $b === false))) !== false && $a !== nil) {
          self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "element size differs (" + (row.length) + " should be " + (max))};
        return ($a = ($b = (row.length)).$times, $a._p = (TMP_23 = function(i){var self = TMP_23._s || this, $a, $b, $c, entry = nil;if (i == null) i = nil;
        entry = (($a = i, $b = result, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, []))));
          return entry['$<<'](row.$at(i));}, TMP_23._s = self, TMP_23), $a).call($b);}, TMP_22._s = self, TMP_22), $a).call($b);
      return result;
    };

    def.$uniq = function() {
      var self = this;
      
      var result = [],
          seen   = {};

      for (var i = 0, length = self.length, item, hash; i < length; i++) {
        item = self[i];
        hash = item;

        if (!seen[hash]) {
          seen[hash] = true;

          result.push(item);
        }
      }

      return result;
    
    };

    def['$uniq!'] = function() {
      var self = this;
      
      var original = self.length,
          seen     = {};

      for (var i = 0, length = original, item, hash; i < length; i++) {
        item = self[i];
        hash = item;

        if (!seen[hash]) {
          seen[hash] = true;
        }
        else {
          self.splice(i, 1);

          length--;
          i--;
        }
      }

      return self.length === original ? nil : self;
    
    };

    def.$unshift = function(objects) {
      var self = this;
      objects = $slice.call(arguments, 0);
      
      for (var i = objects.length - 1; i >= 0; i--) {
        self.unshift(objects[i]);
      }
    
      return self;
    };

    return (def.$zip = TMP_24 = function(others) {
      var self = this, $iter = TMP_24._p, block = $iter || nil;
      others = $slice.call(arguments, 0);
      TMP_24._p = null;
      
      var result = [], size = self.length, part, o;

      for (var i = 0; i < size; i++) {
        part = [self[i]];

        for (var j = 0, jj = others.length; j < jj; j++) {
          o = others[j][i];

          if (o == null) {
            o = nil;
          }

          part[j + 1] = o;
        }

        result[i] = part;
      }

      if (block !== nil) {
        for (var i = 0; i < size; i++) {
          block(result[i]);
        }

        return nil;
      }

      return result;
    
    }, nil);
  })(self, null);
  return (function($base, $super) {
    function $Wrapper(){};
    var self = $Wrapper = $klass($base, $super, 'Wrapper', $Wrapper);

    var def = $Wrapper._proto, $scope = $Wrapper._scope, TMP_25, TMP_26, TMP_27, TMP_28, TMP_29;
    def.literal = nil;
    $opal.defs(self, '$allocate', TMP_25 = function(array) {
      var self = this, $iter = TMP_25._p, $yield = $iter || nil, obj = nil;
      if (array == null) {
        array = []
      }
      TMP_25._p = null;
      obj = $opal.find_super_dispatcher(self, 'allocate', TMP_25, null, $Wrapper).apply(self, []);
      obj.literal = array;
      return obj;
    });

    $opal.defs(self, '$new', TMP_26 = function(args) {
      var $a, $b, self = this, $iter = TMP_26._p, block = $iter || nil, obj = nil;
      args = $slice.call(arguments, 0);
      TMP_26._p = null;
      obj = self.$allocate();
      ($a = ($b = obj).$initialize, $a._p = block.$to_proc(), $a).apply($b, [].concat(args));
      return obj;
    });

    $opal.defs(self, '$[]', function(objects) {
      var self = this;
      objects = $slice.call(arguments, 0);
      return self.$allocate(objects);
    });

    def.$initialize = TMP_27 = function(args) {
      var $a, $b, $c, self = this, $iter = TMP_27._p, block = $iter || nil;
      args = $slice.call(arguments, 0);
      TMP_27._p = null;
      return self.literal = ($a = ($b = (($c = $scope.Array) == null ? $opal.cm('Array') : $c)).$new, $a._p = block.$to_proc(), $a).apply($b, [].concat(args));
    };

    def.$method_missing = TMP_28 = function(args) {
      var $a, $b, self = this, $iter = TMP_28._p, block = $iter || nil, result = nil;
      args = $slice.call(arguments, 0);
      TMP_28._p = null;
      result = ($a = ($b = self.literal).$__send__, $a._p = block.$to_proc(), $a).apply($b, [].concat(args));
      if (($a = result === self.literal) !== false && $a !== nil) {
        return self
        } else {
        return result
      };
    };

    def.$initialize_copy = function(other) {
      var self = this;
      return self.literal = (other.literal).$clone();
    };

    def['$respond_to?'] = TMP_29 = function(name) {var $zuper = $slice.call(arguments, 0);
      var $a, self = this, $iter = TMP_29._p, $yield = $iter || nil;
      TMP_29._p = null;
      return ((($a = $opal.find_super_dispatcher(self, 'respond_to?', TMP_29, $iter).apply(self, $zuper)) !== false && $a !== nil) ? $a : self.literal['$respond_to?'](name));
    };

    def['$=='] = function(other) {
      var self = this;
      return self.literal['$=='](other);
    };

    def['$eql?'] = function(other) {
      var self = this;
      return self.literal['$eql?'](other);
    };

    def.$to_a = function() {
      var self = this;
      return self.literal;
    };

    def.$to_ary = function() {
      var self = this;
      return self;
    };

    def.$inspect = function() {
      var self = this;
      return self.literal.$inspect();
    };

    def['$*'] = function(other) {
      var self = this;
      
      var result = self.literal['$*'](other);

      if (result._isArray) {
        return self.$class().$allocate(result)
      }
      else {
        return result;
      }
    ;
    };

    def['$[]'] = function(index, length) {
      var self = this;
      
      var result = self.literal.$slice(index, length);

      if (result._isArray && (index._isRange || length !== undefined)) {
        return self.$class().$allocate(result)
      }
      else {
        return result;
      }
    ;
    };

    $opal.defn(self, '$slice', def['$[]']);

    def.$uniq = function() {
      var self = this;
      return self.$class().$allocate(self.literal.$uniq());
    };

    return (def.$flatten = function(level) {
      var self = this;
      return self.$class().$allocate(self.literal.$flatten(level));
    }, nil);
  })((($a = $scope.Array) == null ? $opal.cm('Array') : $a), null);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/array.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$include', '$==', '$call', '$enum_for', '$raise', '$flatten', '$inspect', '$alias_method', '$clone']);
  return (function($base, $super) {
    function $Hash(){};
    var self = $Hash = $klass($base, $super, 'Hash', $Hash);

    var def = $Hash._proto, $scope = $Hash._scope, $a, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12;
    def.proc = def.none = nil;
    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    var $hasOwn = {}.hasOwnProperty;

    $opal.defs(self, '$[]', function(objs) {
      var self = this;
      objs = $slice.call(arguments, 0);
      return $opal.hash.apply(null, objs);
    });

    $opal.defs(self, '$allocate', function() {
      var self = this;
      
      var hash = new self._alloc;

      hash.map  = {};
      hash.keys = [];

      return hash;
    
    });

    def.$initialize = TMP_1 = function(defaults) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;
      TMP_1._p = null;
      
      if (defaults != null) {
        self.none = defaults;
      }
      else if (block !== nil) {
        self.proc = block;
      }

      return self;
    
    };

    def['$=='] = function(other) {
      var $a, self = this;
      
      if (self === other) {
        return true;
      }

      if (!other.map || !other.keys) {
        return false;
      }

      if (self.keys.length !== other.keys.length) {
        return false;
      }

      var map  = self.map,
          map2 = other.map;

      for (var i = 0, length = self.keys.length; i < length; i++) {
        var key = self.keys[i], obj = map[key], obj2 = map2[key];

        if (($a = (obj)['$=='](obj2), ($a === nil || $a === false))) {
          return false;
        }
      }

      return true;
    
    };

    def['$[]'] = function(key) {
      var self = this;
      
      var map = self.map;

      if ($hasOwn.call(map, key)) {
        return map[key];
      }

      var proc = self.proc;

      if (proc !== nil) {
        return (proc).$call(self, key);
      }

      return self.none;
    
    };

    def['$[]='] = function(key, value) {
      var self = this;
      
      var map = self.map;

      if (!$hasOwn.call(map, key)) {
        self.keys.push(key);
      }

      map[key] = value;

      return value;
    
    };

    def.$assoc = function(object) {
      var self = this;
      
      var keys = self.keys, key;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if ((key)['$=='](object)) {
          return [key, self.map[key]];
        }
      }

      return nil;
    
    };

    def.$clear = function() {
      var self = this;
      
      self.map = {};
      self.keys = [];
      return self;
    
    };

    def.$clone = function() {
      var self = this;
      
      var map  = {},
          keys = [];

      for (var i = 0, length = self.keys.length; i < length; i++) {
        var key   = self.keys[i],
            value = self.map[key];

        keys.push(key);
        map[key] = value;
      }

      var hash = new self._klass._alloc();

      hash.map  = map;
      hash.keys = keys;
      hash.none = self.none;
      hash.proc = self.proc;

      return hash;
    
    };

    def.$default = function(val) {
      var self = this;
      return self.none;
    };

    def['$default='] = function(object) {
      var self = this;
      return self.none = object;
    };

    def.$default_proc = function() {
      var self = this;
      return self.proc;
    };

    def['$default_proc='] = function(proc) {
      var self = this;
      return self.proc = proc;
    };

    def.$delete = function(key) {
      var self = this;
      
      var map  = self.map, result = map[key];

      if (result != null) {
        delete map[key];
        self.keys.$delete(key);

        return result;
      }

      return nil;
    
    };

    def.$delete_if = TMP_2 = function() {
      var $a, self = this, $iter = TMP_2._p, block = $iter || nil;
      TMP_2._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("delete_if")};
      
      var map = self.map, keys = self.keys, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((value = block(key, obj)) === $breaker) {
          return $breaker.$v;
        }

        if (value !== false && value !== nil) {
          keys.splice(i, 1);
          delete map[key];

          length--;
          i--;
        }
      }

      return self;
    
    };

    $opal.defn(self, '$dup', def.$clone);

    def.$each = TMP_3 = function() {
      var $a, self = this, $iter = TMP_3._p, block = $iter || nil;
      TMP_3._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("each")};
      
      var map  = self.map,
          keys = self.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key   = keys[i],
            value = $opal.$yield1(block, [key, map[key]]);

        if (value === $breaker) {
          return $breaker.$v;
        }
      }

      return self;
    
    };

    def.$each_key = TMP_4 = function() {
      var $a, self = this, $iter = TMP_4._p, block = $iter || nil;
      TMP_4._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("each_key")};
      
      var keys = self.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];

        if (block(key) === $breaker) {
          return $breaker.$v;
        }
      }

      return self;
    
    };

    $opal.defn(self, '$each_pair', def.$each);

    def.$each_value = TMP_5 = function() {
      var $a, self = this, $iter = TMP_5._p, block = $iter || nil;
      TMP_5._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("each_value")};
      
      var map = self.map, keys = self.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        if (block(map[keys[i]]) === $breaker) {
          return $breaker.$v;
        }
      }

      return self;
    
    };

    def['$empty?'] = function() {
      var self = this;
      return self.keys.length === 0;
    };

    $opal.defn(self, '$eql?', def['$==']);

    def.$fetch = TMP_6 = function(key, defaults) {
      var $a, self = this, $iter = TMP_6._p, block = $iter || nil;
      TMP_6._p = null;
      
      var value = self.map[key];

      if (value != null) {
        return value;
      }

      if (block !== nil) {
        var value;

        if ((value = block(key)) === $breaker) {
          return $breaker.$v;
        }

        return value;
      }

      if (defaults != null) {
        return defaults;
      }

      self.$raise((($a = $scope.KeyError) == null ? $opal.cm('KeyError') : $a), "key not found");
    
    };

    def.$flatten = function(level) {
      var self = this;
      
      var map = self.map, keys = self.keys, result = [];

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], value = map[key];

        result.push(key);

        if (value._isArray) {
          if (level == null || level === 1) {
            result.push(value);
          }
          else {
            result = result.concat((value).$flatten(level - 1));
          }
        }
        else {
          result.push(value);
        }
      }

      return result;
    
    };

    def['$has_key?'] = function(key) {
      var self = this;
      return $hasOwn.call(self.map, key);
    };

    def['$has_value?'] = function(value) {
      var self = this;
      
      for (var assoc in self.map) {
        if ((self.map[assoc])['$=='](value)) {
          return true;
        }
      }

      return false;
    ;
    };

    def.$hash = function() {
      var self = this;
      return self._id;
    };

    $opal.defn(self, '$include?', def['$has_key?']);

    def.$index = function(object) {
      var self = this;
      
      var map = self.map, keys = self.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];

        if ((map[key])['$=='](object)) {
          return key;
        }
      }

      return nil;
    
    };

    def.$indexes = function(keys) {
      var self = this;
      keys = $slice.call(arguments, 0);
      
      var result = [], map = self.map, val;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], val = map[key];

        if (val != null) {
          result.push(val);
        }
        else {
          result.push(self.none);
        }
      }

      return result;
    
    };

    $opal.defn(self, '$indices', def.$indexes);

    def.$inspect = function() {
      var self = this;
      
      var inspect = [], keys = self.keys, map = self.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], val = map[key];

        if (val === self) {
          inspect.push((key).$inspect() + '=>' + '{...}');
        } else {
          inspect.push((key).$inspect() + '=>' + (map[key]).$inspect());
        }
      }

      return '{' + inspect.join(', ') + '}';
    ;
    };

    def.$invert = function() {
      var self = this;
      
      var result = $opal.hash(), keys = self.keys, map = self.map,
          keys2 = result.keys, map2 = result.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        keys2.push(obj);
        map2[obj] = key;
      }

      return result;
    
    };

    def.$keep_if = TMP_7 = function() {
      var $a, self = this, $iter = TMP_7._p, block = $iter || nil;
      TMP_7._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("keep_if")};
      
      var map = self.map, keys = self.keys, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((value = block(key, obj)) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          keys.splice(i, 1);
          delete map[key];

          length--;
          i--;
        }
      }

      return self;
    
    };

    $opal.defn(self, '$key', def.$index);

    $opal.defn(self, '$key?', def['$has_key?']);

    def.$keys = function() {
      var self = this;
      return self.keys.slice(0);
    };

    def.$length = function() {
      var self = this;
      return self.keys.length;
    };

    $opal.defn(self, '$member?', def['$has_key?']);

    def.$merge = TMP_8 = function(other) {
      var self = this, $iter = TMP_8._p, block = $iter || nil;
      TMP_8._p = null;
      
      var keys = self.keys, map = self.map,
          result = $opal.hash(), keys2 = result.keys, map2 = result.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];

        keys2.push(key);
        map2[key] = map[key];
      }

      var keys = other.keys, map = other.map;

      if (block === nil) {
        for (var i = 0, length = keys.length; i < length; i++) {
          var key = keys[i];

          if (map2[key] == null) {
            keys2.push(key);
          }

          map2[key] = map[key];
        }
      }
      else {
        for (var i = 0, length = keys.length; i < length; i++) {
          var key = keys[i];

          if (map2[key] == null) {
            keys2.push(key);
            map2[key] = map[key];
          }
          else {
            map2[key] = block(key, map2[key], map[key]);
          }
        }
      }

      return result;
    
    };

    def['$merge!'] = TMP_9 = function(other) {
      var self = this, $iter = TMP_9._p, block = $iter || nil;
      TMP_9._p = null;
      
      var keys = self.keys, map = self.map,
          keys2 = other.keys, map2 = other.map;

      if (block === nil) {
        for (var i = 0, length = keys2.length; i < length; i++) {
          var key = keys2[i];

          if (map[key] == null) {
            keys.push(key);
          }

          map[key] = map2[key];
        }
      }
      else {
        for (var i = 0, length = keys2.length; i < length; i++) {
          var key = keys2[i];

          if (map[key] == null) {
            keys.push(key);
            map[key] = map2[key];
          }
          else {
            map[key] = block(key, map[key], map2[key]);
          }
        }
      }

      return self;
    
    };

    def.$rassoc = function(object) {
      var self = this;
      
      var keys = self.keys, map = self.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((obj)['$=='](object)) {
          return [key, obj];
        }
      }

      return nil;
    
    };

    def.$reject = TMP_10 = function() {
      var $a, self = this, $iter = TMP_10._p, block = $iter || nil;
      TMP_10._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("reject")};
      
      var keys = self.keys, map = self.map,
          result = $opal.hash(), map2 = result.map, keys2 = result.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key], value;

        if ((value = block(key, obj)) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          keys2.push(key);
          map2[key] = obj;
        }
      }

      return result;
    
    };

    def.$replace = function(other) {
      var self = this;
      
      var map = self.map = {}, keys = self.keys = [];

      for (var i = 0, length = other.keys.length; i < length; i++) {
        var key = other.keys[i];
        keys.push(key);
        map[key] = other.map[key];
      }

      return self;
    
    };

    def.$select = TMP_11 = function() {
      var $a, self = this, $iter = TMP_11._p, block = $iter || nil;
      TMP_11._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("select")};
      
      var keys = self.keys, map = self.map,
          result = $opal.hash(), map2 = result.map, keys2 = result.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key], value;

        if ((value = block(key, obj)) === $breaker) {
          return $breaker.$v;
        }

        if (value !== false && value !== nil) {
          keys2.push(key);
          map2[key] = obj;
        }
      }

      return result;
    
    };

    def['$select!'] = TMP_12 = function() {
      var $a, self = this, $iter = TMP_12._p, block = $iter || nil;
      TMP_12._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("select!")};
      
      var map = self.map, keys = self.keys, value, result = nil;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((value = block(key, obj)) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          keys.splice(i, 1);
          delete map[key];

          length--;
          i--;
          result = self
        }
      }

      return result;
    
    };

    def.$shift = function() {
      var self = this;
      
      var keys = self.keys, map = self.map;

      if (keys.length) {
        var key = keys[0], obj = map[key];

        delete map[key];
        keys.splice(0, 1);

        return [key, obj];
      }

      return nil;
    
    };

    $opal.defn(self, '$size', def.$length);

    self.$alias_method("store", "[]=");

    def.$to_a = function() {
      var self = this;
      
      var keys = self.keys, map = self.map, result = [];

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];
        result.push([key, map[key]]);
      }

      return result;
    
    };

    def.$to_h = function() {
      var self = this;
      
      var hash   = new Opal.Hash._alloc,
          cloned = self.$clone();

      hash.map  = cloned.map;
      hash.keys = cloned.keys;
      hash.none = cloned.none;
      hash.proc = cloned.proc;

      return hash;
    ;
    };

    def.$to_hash = function() {
      var self = this;
      return self;
    };

    $opal.defn(self, '$to_s', def.$inspect);

    $opal.defn(self, '$update', def['$merge!']);

    $opal.defn(self, '$value?', def['$has_value?']);

    $opal.defn(self, '$values_at', def.$indexes);

    return (def.$values = function() {
      var self = this;
      
      var map    = self.map,
          result = [];

      for (var key in map) {
        result.push(map[key]);
      }

      return result;
    
    }, nil);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/hash.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $gvars = $opal.gvars;
  $opal.add_stubs(['$include', '$to_str', '$===', '$format', '$coerce_to', '$to_s', '$respond_to?', '$<=>', '$raise', '$=~', '$empty?', '$ljust', '$ceil', '$/', '$+', '$rjust', '$floor', '$to_a', '$each_char', '$coerce_to!', '$enum_for', '$split', '$chomp', '$escape', '$class', '$to_i', '$name', '$each_line', '$match', '$to_proc', '$new', '$is_a?', '$[]', '$str', '$value', '$try_convert']);
  (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = $String._proto, $scope = $String._scope, $a, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6;
    def.length = nil;
    self.$include((($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a));

    def._isString = true;

    $opal.defs(self, '$try_convert', function(what) {
      var self = this;
      try {
      return what.$to_str()
      } catch ($err) {if (true) {
        return nil
        }else { throw $err; }
      };
    });

    $opal.defs(self, '$new', function(str) {
      var self = this;
      if (str == null) {
        str = ""
      }
      return new String(str);
    });

    def['$%'] = function(data) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](data)) !== false && $a !== nil) {
        return ($a = self).$format.apply($a, [self].concat(data))
        } else {
        return self.$format(self, data)
      };
    };

    def['$*'] = function(count) {
      var self = this;
      
      if (count < 1) {
        return '';
      }

      var result  = '',
          pattern = self;

      while (count > 0) {
        if (count & 1) {
          result += pattern;
        }

        count >>= 1;
        pattern += pattern;
      }

      return result;
    
    };

    def['$+'] = function(other) {
      var $a, self = this;
      other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str");
      return self + other.$to_s();
    };

    def['$<=>'] = function(other) {
      var $a, self = this;
      if (($a = other['$respond_to?']("to_str")) !== false && $a !== nil) {
        other = other.$to_str().$to_s();
        return self > other ? 1 : (self < other ? -1 : 0);
        } else {
        
        var cmp = other['$<=>'](self);

        if (cmp === nil) {
          return nil;
        }
        else {
          return cmp > 0 ? -1 : (cmp < 0 ? 1 : 0);
        }
      ;
      };
    };

    def['$=='] = function(other) {
      var self = this;
      return !!(other._isString && self.valueOf() === other.valueOf());
    };

    $opal.defn(self, '$===', def['$==']);

    def['$=~'] = function(other) {
      var $a, self = this;
      
      if (other._isString) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "type mismatch: String given");
      }

      return other['$=~'](self);
    ;
    };

    def['$[]'] = function(index, length) {
      var self = this;
      
      var size = self.length;

      if (index._isRange) {
        var exclude = index.exclude,
            length  = index.end,
            index   = index.begin;

        if (index < 0) {
          index += size;
        }

        if (length < 0) {
          length += size;
        }

        if (!exclude) {
          length += 1;
        }

        if (index > size) {
          return nil;
        }

        length = length - index;

        if (length < 0) {
          length = 0;
        }

        return self.substr(index, length);
      }

      if (index < 0) {
        index += self.length;
      }

      if (length == null) {
        if (index >= self.length || index < 0) {
          return nil;
        }

        return self.substr(index, 1);
      }

      if (index > self.length || index < 0) {
        return nil;
      }

      return self.substr(index, length);
    
    };

    def.$capitalize = function() {
      var self = this;
      return self.charAt(0).toUpperCase() + self.substr(1).toLowerCase();
    };

    def.$casecmp = function(other) {
      var $a, self = this;
      other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      return (self.toLowerCase())['$<=>'](other.toLowerCase());
    };

    def.$center = function(width, padstr) {
      var $a, self = this;
      if (padstr == null) {
        padstr = " "
      }
      width = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(width, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      padstr = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(padstr, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      if (($a = padstr['$empty?']()) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "zero width padding")};
      if (($a = width <= self.length) !== false && $a !== nil) {
        return self};
      
      var ljustified = self.$ljust((width['$+'](self.length))['$/'](2).$ceil(), padstr),
          rjustified = self.$rjust((width['$+'](self.length))['$/'](2).$floor(), padstr);

      return rjustified + ljustified.slice(self.length);
    ;
    };

    def.$chars = function() {
      var self = this;
      return self.$each_char().$to_a();
    };

    def.$chomp = function(separator) {
      var $a, self = this;
      if (separator == null) {
        separator = $gvars["/"]
      }
      if (($a = separator === nil || self.length === 0) !== false && $a !== nil) {
        return self};
      separator = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](separator, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      
      if (separator === "\n") {
        return self.replace(/\r?\n?$/, '');
      }
      else if (separator === "") {
        return self.replace(/(\r?\n)+$/, '');
      }
      else if (self.length > separator.length) {
        var tail = self.substr(-1 * separator.length);

        if (tail === separator) {
          return self.substr(0, self.length - separator.length);
        }
      }
    
      return self;
    };

    def.$chop = function() {
      var self = this;
      
      var length = self.length;

      if (length <= 1) {
        return "";
      }

      if (self.charAt(length - 1) === "\n" && self.charAt(length - 2) === "\r") {
        return self.substr(0, length - 2);
      }
      else {
        return self.substr(0, length - 1);
      }
    
    };

    def.$chr = function() {
      var self = this;
      return self.charAt(0);
    };

    def.$clone = function() {
      var self = this;
      return self.slice();
    };

    def.$count = function(str) {
      var self = this;
      return (self.length - self.replace(new RegExp(str, 'g'), '').length) / str.length;
    };

    $opal.defn(self, '$dup', def.$clone);

    def.$downcase = function() {
      var self = this;
      return self.toLowerCase();
    };

    def.$each_char = TMP_1 = function() {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil;
      TMP_1._p = null;
      if (block === nil) {
        return self.$enum_for("each_char")};
      
      for (var i = 0, length = self.length; i < length; i++) {
        ((($a = $opal.$yield1(block, self.charAt(i))) === $breaker) ? $breaker.$v : $a);
      }
    
      return self;
    };

    def.$each_line = TMP_2 = function(separator) {
      var $a, self = this, $iter = TMP_2._p, $yield = $iter || nil;
      if (separator == null) {
        separator = $gvars["/"]
      }
      TMP_2._p = null;
      if ($yield === nil) {
        return self.$split(separator)};
      
      var chomped  = self.$chomp(),
          trailing = self.length != chomped.length,
          splitted = chomped.split(separator);

      for (var i = 0, length = splitted.length; i < length; i++) {
        if (i < length - 1 || trailing) {
          ((($a = $opal.$yield1($yield, splitted[i] + separator)) === $breaker) ? $breaker.$v : $a);
        }
        else {
          ((($a = $opal.$yield1($yield, splitted[i])) === $breaker) ? $breaker.$v : $a);
        }
      }
    ;
      return self;
    };

    def['$empty?'] = function() {
      var self = this;
      return self.length === 0;
    };

    def['$end_with?'] = function(suffixes) {
      var $a, self = this;
      suffixes = $slice.call(arguments, 0);
      
      for (var i = 0, length = suffixes.length; i < length; i++) {
        var suffix = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(suffixes[i], (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str");

        if (self.length >= suffix.length && self.substr(0 - suffix.length) === suffix) {
          return true;
        }
      }
    
      return false;
    };

    $opal.defn(self, '$eql?', def['$==']);

    $opal.defn(self, '$equal?', def['$===']);

    def.$gsub = TMP_3 = function(pattern, replace) {
      var $a, $b, $c, self = this, $iter = TMP_3._p, block = $iter || nil;
      TMP_3._p = null;
      if (($a = ((($b = (($c = $scope.String) == null ? $opal.cm('String') : $c)['$==='](pattern)) !== false && $b !== nil) ? $b : pattern['$respond_to?']("to_str"))) !== false && $a !== nil) {
        pattern = (new RegExp("" + (($a = $scope.Regexp) == null ? $opal.cm('Regexp') : $a).$escape(pattern.$to_str())))};
      if (($a = (($b = $scope.Regexp) == null ? $opal.cm('Regexp') : $b)['$==='](pattern)) === false || $a === nil) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "wrong argument type " + (pattern.$class()) + " (expected Regexp)")};
      
      var pattern = pattern.toString(),
          options = pattern.substr(pattern.lastIndexOf('/') + 1) + 'g',
          regexp  = pattern.substr(1, pattern.lastIndexOf('/') - 1);

      self.$sub._p = block;
      return self.$sub(new RegExp(regexp, options), replace);
    
    };

    def.$hash = function() {
      var self = this;
      return self.toString();
    };

    def.$hex = function() {
      var self = this;
      return self.$to_i(16);
    };

    def['$include?'] = function(other) {
      var $a, self = this;
      
      if (other._isString) {
        return self.indexOf(other) !== -1;
      }
    
      if (($a = other['$respond_to?']("to_str")) === false || $a === nil) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "no implicit conversion of " + (other.$class().$name()) + " into String")};
      return self.indexOf(other.$to_str()) !== -1;
    };

    def.$index = function(what, offset) {
      var $a, $b, $c, self = this, result = nil;
      if (offset == null) {
        offset = nil
      }
      if (($a = (($b = $scope.String) == null ? $opal.cm('String') : $b)['$==='](what)) !== false && $a !== nil) {
        what = what.$to_s()
      } else if (($a = what['$respond_to?']("to_str")) !== false && $a !== nil) {
        what = what.$to_str().$to_s()
      } else if (($a = ($b = (($c = $scope.Regexp) == null ? $opal.cm('Regexp') : $c)['$==='](what), ($b === nil || $b === false))) !== false && $a !== nil) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "type mismatch: " + (what.$class()) + " given")};
      result = -1;
      if (offset !== false && offset !== nil) {
        offset = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(offset, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        
        var size = self.length;

        if (offset < 0) {
          offset = offset + size;
        }

        if (offset > size) {
          return nil;
        }
      
        if (($a = (($b = $scope.Regexp) == null ? $opal.cm('Regexp') : $b)['$==='](what)) !== false && $a !== nil) {
          result = ((($a = (what['$=~'](self.substr(offset)))) !== false && $a !== nil) ? $a : -1)
          } else {
          result = self.substr(offset).indexOf(what)
        };
        
        if (result !== -1) {
          result += offset;
        }
      
      } else if (($a = (($b = $scope.Regexp) == null ? $opal.cm('Regexp') : $b)['$==='](what)) !== false && $a !== nil) {
        result = ((($a = (what['$=~'](self))) !== false && $a !== nil) ? $a : -1)
        } else {
        result = self.indexOf(what)
      };
      if (($a = result === -1) !== false && $a !== nil) {
        return nil
        } else {
        return result
      };
    };

    def.$inspect = function() {
      var self = this;
      
      var escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
          meta      = {
            '\b': '\\b',
            '\t': '\\t',
            '\n': '\\n',
            '\f': '\\f',
            '\r': '\\r',
            '"' : '\\"',
            '\\': '\\\\'
          };

      escapable.lastIndex = 0;

      return escapable.test(self) ? '"' + self.replace(escapable, function(a) {
        var c = meta[a];

        return typeof c === 'string' ? c :
          '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
      }) + '"' : '"' + self + '"';
    
    };

    def.$intern = function() {
      var self = this;
      return self;
    };

    def.$lines = function(separator) {
      var self = this;
      if (separator == null) {
        separator = $gvars["/"]
      }
      return self.$each_line(separator).$to_a();
    };

    def.$length = function() {
      var self = this;
      return self.length;
    };

    def.$ljust = function(width, padstr) {
      var $a, self = this;
      if (padstr == null) {
        padstr = " "
      }
      width = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(width, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      padstr = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(padstr, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      if (($a = padstr['$empty?']()) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "zero width padding")};
      if (($a = width <= self.length) !== false && $a !== nil) {
        return self};
      
      var index  = -1,
          result = "";

      width -= self.length;

      while (++index < width) {
        result += padstr;
      }

      return self + result.slice(0, width);
    
    };

    def.$lstrip = function() {
      var self = this;
      return self.replace(/^\s*/, '');
    };

    def.$match = TMP_4 = function(pattern, pos) {
      var $a, $b, $c, self = this, $iter = TMP_4._p, block = $iter || nil;
      TMP_4._p = null;
      if (($a = ((($b = (($c = $scope.String) == null ? $opal.cm('String') : $c)['$==='](pattern)) !== false && $b !== nil) ? $b : pattern['$respond_to?']("to_str"))) !== false && $a !== nil) {
        pattern = (new RegExp("" + (($a = $scope.Regexp) == null ? $opal.cm('Regexp') : $a).$escape(pattern.$to_str())))};
      if (($a = (($b = $scope.Regexp) == null ? $opal.cm('Regexp') : $b)['$==='](pattern)) === false || $a === nil) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "wrong argument type " + (pattern.$class()) + " (expected Regexp)")};
      return ($a = ($b = pattern).$match, $a._p = block.$to_proc(), $a).call($b, self, pos);
    };

    def.$next = function() {
      var self = this;
      
      if (self.length === 0) {
        return "";
      }

      var initial = self.substr(0, self.length - 1);
      var last    = String.fromCharCode(self.charCodeAt(self.length - 1) + 1);

      return initial + last;
    ;
    };

    def.$ord = function() {
      var self = this;
      return self.charCodeAt(0);
    };

    def.$partition = function(str) {
      var self = this;
      
      var result = self.split(str);
      var splitter = (result[0].length === self.length ? "" : str);

      return [result[0], splitter, result.slice(1).join(str.toString())];
    ;
    };

    def.$reverse = function() {
      var self = this;
      return self.split('').reverse().join('');
    };

    def.$rindex = function(search, offset) {
      var $a, self = this;
      
      var search_type = (search == null ? Opal.NilClass : search.constructor);
      if (search_type != String && search_type != RegExp) {
        var msg = "type mismatch: " + search_type + " given";
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a).$new(msg));
      }

      if (self.length == 0) {
        return search.length == 0 ? 0 : nil;
      }

      var result = -1;
      if (offset != null) {
        if (offset < 0) {
          offset = self.length + offset;
        }

        if (search_type == String) {
          result = self.lastIndexOf(search, offset);
        }
        else {
          result = self.substr(0, offset + 1).$reverse().search(search);
          if (result !== -1) {
            result = offset - result;
          }
        }
      }
      else {
        if (search_type == String) {
          result = self.lastIndexOf(search);
        }
        else {
          result = self.$reverse().search(search);
          if (result !== -1) {
            result = self.length - 1 - result;
          }
        }
      }

      return result === -1 ? nil : result;
    
    };

    def.$rjust = function(width, padstr) {
      var $a, self = this;
      if (padstr == null) {
        padstr = " "
      }
      width = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(width, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      padstr = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(padstr, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      if (($a = padstr['$empty?']()) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "zero width padding")};
      if (($a = width <= self.length) !== false && $a !== nil) {
        return self};
      
      var chars     = Math.floor(width - self.length),
          patterns  = Math.floor(chars / padstr.length),
          result    = Array(patterns + 1).join(padstr),
          remaining = chars - result.length;

      return result + padstr.slice(0, remaining) + self;
    
    };

    def.$rstrip = function() {
      var self = this;
      return self.replace(/\s*$/, '');
    };

    def.$scan = TMP_5 = function(pattern) {
      var $a, self = this, $iter = TMP_5._p, block = $iter || nil;
      TMP_5._p = null;
      
      if (pattern.global) {
        // should we clear it afterwards too?
        pattern.lastIndex = 0;
      }
      else {
        // rewrite regular expression to add the global flag to capture pre/post match
        pattern = new RegExp(pattern.source, 'g' + (pattern.multiline ? 'm' : '') + (pattern.ignoreCase ? 'i' : ''));
      }

      var result = [];
      var match;

      while ((match = pattern.exec(self)) != null) {
        var match_data = (($a = $scope.MatchData) == null ? $opal.cm('MatchData') : $a).$new(pattern, match);
        if (block === nil) {
          match.length == 1 ? result.push(match[0]) : result.push(match.slice(1));
        }
        else {
          match.length == 1 ? block(match[0]) : block.apply(self, match.slice(1));
        }
      }

      return (block !== nil ? self : result);
    ;
    };

    $opal.defn(self, '$size', def.$length);

    $opal.defn(self, '$slice', def['$[]']);

    def.$split = function(pattern, limit) {
      var self = this, $a;
      if (pattern == null) {
        pattern = ((($a = $gvars[";"]) !== false && $a !== nil) ? $a : " ")
      }
      return self.split(pattern, limit);
    };

    def['$start_with?'] = function(prefixes) {
      var $a, self = this;
      prefixes = $slice.call(arguments, 0);
      
      for (var i = 0, length = prefixes.length; i < length; i++) {
        var prefix = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(prefixes[i], (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str");

        if (self.indexOf(prefix) === 0) {
          return true;
        }
      }

      return false;
    
    };

    def.$strip = function() {
      var self = this;
      return self.replace(/^\s*/, '').replace(/\s*$/, '');
    };

    def.$sub = TMP_6 = function(pattern, replace) {
      var $a, self = this, $iter = TMP_6._p, block = $iter || nil;
      TMP_6._p = null;
      
      if (typeof(replace) === 'string') {
        // convert Ruby back reference to JavaScript back reference
        replace = replace.replace(/\\([1-9])/g, '$$$1')
        return self.replace(pattern, replace);
      }
      if (block !== nil) {
        return self.replace(pattern, function() {
          // FIXME: this should be a formal MatchData object with all the goodies
          var match_data = []
          for (var i = 0, len = arguments.length; i < len; i++) {
            var arg = arguments[i];
            if (arg == undefined) {
              match_data.push(nil);
            }
            else {
              match_data.push(arg);
            }
          }

          var str = match_data.pop();
          var offset = match_data.pop();
          var match_len = match_data.length;

          // $1, $2, $3 not being parsed correctly in Ruby code
          //for (var i = 1; i < match_len; i++) {
          //  __gvars[String(i)] = match_data[i];
          //}
          $gvars["&"] = match_data[0];
          $gvars["~"] = match_data;
          return block(match_data[0]);
        });
      }
      else if (replace !== undefined) {
        if (replace['$is_a?']((($a = $scope.Hash) == null ? $opal.cm('Hash') : $a))) {
          return self.replace(pattern, function(str) {
            var value = replace['$[]'](self.$str());

            return (value == null) ? nil : self.$value().$to_s();
          });
        }
        else {
          replace = (($a = $scope.String) == null ? $opal.cm('String') : $a).$try_convert(replace);

          if (replace == null) {
            self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "can't convert " + (replace.$class()) + " into String");
          }

          return self.replace(pattern, replace);
        }
      }
      else {
        // convert Ruby back reference to JavaScript back reference
        replace = replace.toString().replace(/\\([1-9])/g, '$$$1')
        return self.replace(pattern, replace);
      }
    ;
    };

    $opal.defn(self, '$succ', def.$next);

    def.$sum = function(n) {
      var self = this;
      if (n == null) {
        n = 16
      }
      
      var result = 0;

      for (var i = 0, length = self.length; i < length; i++) {
        result += (self.charCodeAt(i) % ((1 << n) - 1));
      }

      return result;
    
    };

    def.$swapcase = function() {
      var self = this;
      
      var str = self.replace(/([a-z]+)|([A-Z]+)/g, function($0,$1,$2) {
        return $1 ? $0.toUpperCase() : $0.toLowerCase();
      });

      if (self.constructor === String) {
        return str;
      }

      return self.$class().$new(str);
    ;
    };

    def.$to_a = function() {
      var self = this;
      
      if (self.length === 0) {
        return [];
      }

      return [self];
    ;
    };

    def.$to_f = function() {
      var self = this;
      
      var result = parseFloat(self);

      return isNaN(result) ? 0 : result;
    ;
    };

    def.$to_i = function(base) {
      var self = this;
      if (base == null) {
        base = 10
      }
      
      var result = parseInt(self, base);

      if (isNaN(result)) {
        return 0;
      }

      return result;
    ;
    };

    def.$to_proc = function() {
      var self = this;
      
      var name = '$' + self;

      return function(arg) {
        var meth = arg[name];
        return meth ? meth.call(arg) : arg.$method_missing(name);
      };
    ;
    };

    def.$to_s = function() {
      var self = this;
      return self.toString();
    };

    $opal.defn(self, '$to_str', def.$to_s);

    $opal.defn(self, '$to_sym', def.$intern);

    def.$tr = function(from, to) {
      var self = this;
      
      if (from.length == 0 || from === to) {
        return self;
      }

      var subs = {};
      var from_chars = from.split('');
      var from_length = from_chars.length;
      var to_chars = to.split('');
      var to_length = to_chars.length;

      var inverse = false;
      var global_sub = null;
      if (from_chars[0] === '^') {
        inverse = true;
        from_chars.shift();
        global_sub = to_chars[to_length - 1]
        from_length -= 1;
      }

      var from_chars_expanded = [];
      var last_from = null;
      var in_range = false;
      for (var i = 0; i < from_length; i++) {
        var char = from_chars[i];
        if (last_from == null) {
          last_from = char;
          from_chars_expanded.push(char);
        }
        else if (char === '-') {
          if (last_from === '-') {
            from_chars_expanded.push('-');
            from_chars_expanded.push('-');
          }
          else if (i == from_length - 1) {
            from_chars_expanded.push('-');
          }
          else {
            in_range = true;
          }
        }
        else if (in_range) {
          var start = last_from.charCodeAt(0) + 1;
          var end = char.charCodeAt(0);
          for (var c = start; c < end; c++) {
            from_chars_expanded.push(String.fromCharCode(c));
          }
          from_chars_expanded.push(char);
          in_range = null;
          last_from = null;
        }
        else {
          from_chars_expanded.push(char);
        }
      }

      from_chars = from_chars_expanded;
      from_length = from_chars.length;

      if (inverse) {
        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = true;
        }
      }
      else {
        if (to_length > 0) {
          var to_chars_expanded = [];
          var last_to = null;
          var in_range = false;
          for (var i = 0; i < to_length; i++) {
            var char = to_chars[i];
            if (last_from == null) {
              last_from = char;
              to_chars_expanded.push(char);
            }
            else if (char === '-') {
              if (last_to === '-') {
                to_chars_expanded.push('-');
                to_chars_expanded.push('-');
              }
              else if (i == to_length - 1) {
                to_chars_expanded.push('-');
              }
              else {
                in_range = true;
              }
            }
            else if (in_range) {
              var start = last_from.charCodeAt(0) + 1;
              var end = char.charCodeAt(0);
              for (var c = start; c < end; c++) {
                to_chars_expanded.push(String.fromCharCode(c));
              }
              to_chars_expanded.push(char);
              in_range = null;
              last_from = null;
            }
            else {
              to_chars_expanded.push(char);
            }
          }

          to_chars = to_chars_expanded;
          to_length = to_chars.length;
        }

        var length_diff = from_length - to_length;
        if (length_diff > 0) {
          var pad_char = (to_length > 0 ? to_chars[to_length - 1] : '');
          for (var i = 0; i < length_diff; i++) {
            to_chars.push(pad_char);
          }
        }

        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = to_chars[i];
        }
      }

      var new_str = ''
      for (var i = 0, length = self.length; i < length; i++) {
        var char = self.charAt(i);
        var sub = subs[char];
        if (inverse) {
          new_str += (sub == null ? global_sub : char);
        }
        else {
          new_str += (sub != null ? sub : char);
        }
      }
      return new_str;
    ;
    };

    def.$tr_s = function(from, to) {
      var self = this;
      
      if (from.length == 0) {
        return self;
      }

      var subs = {};
      var from_chars = from.split('');
      var from_length = from_chars.length;
      var to_chars = to.split('');
      var to_length = to_chars.length;

      var inverse = false;
      var global_sub = null;
      if (from_chars[0] === '^') {
        inverse = true;
        from_chars.shift();
        global_sub = to_chars[to_length - 1]
        from_length -= 1;
      }

      var from_chars_expanded = [];
      var last_from = null;
      var in_range = false;
      for (var i = 0; i < from_length; i++) {
        var char = from_chars[i];
        if (last_from == null) {
          last_from = char;
          from_chars_expanded.push(char);
        }
        else if (char === '-') {
          if (last_from === '-') {
            from_chars_expanded.push('-');
            from_chars_expanded.push('-');
          }
          else if (i == from_length - 1) {
            from_chars_expanded.push('-');
          }
          else {
            in_range = true;
          }
        }
        else if (in_range) {
          var start = last_from.charCodeAt(0) + 1;
          var end = char.charCodeAt(0);
          for (var c = start; c < end; c++) {
            from_chars_expanded.push(String.fromCharCode(c));
          }
          from_chars_expanded.push(char);
          in_range = null;
          last_from = null;
        }
        else {
          from_chars_expanded.push(char);
        }
      }

      from_chars = from_chars_expanded;
      from_length = from_chars.length;

      if (inverse) {
        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = true;
        }
      }
      else {
        if (to_length > 0) {
          var to_chars_expanded = [];
          var last_to = null;
          var in_range = false;
          for (var i = 0; i < to_length; i++) {
            var char = to_chars[i];
            if (last_from == null) {
              last_from = char;
              to_chars_expanded.push(char);
            }
            else if (char === '-') {
              if (last_to === '-') {
                to_chars_expanded.push('-');
                to_chars_expanded.push('-');
              }
              else if (i == to_length - 1) {
                to_chars_expanded.push('-');
              }
              else {
                in_range = true;
              }
            }
            else if (in_range) {
              var start = last_from.charCodeAt(0) + 1;
              var end = char.charCodeAt(0);
              for (var c = start; c < end; c++) {
                to_chars_expanded.push(String.fromCharCode(c));
              }
              to_chars_expanded.push(char);
              in_range = null;
              last_from = null;
            }
            else {
              to_chars_expanded.push(char);
            }
          }

          to_chars = to_chars_expanded;
          to_length = to_chars.length;
        }

        var length_diff = from_length - to_length;
        if (length_diff > 0) {
          var pad_char = (to_length > 0 ? to_chars[to_length - 1] : '');
          for (var i = 0; i < length_diff; i++) {
            to_chars.push(pad_char);
          }
        }

        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = to_chars[i];
        }
      }
      var new_str = ''
      var last_substitute = null
      for (var i = 0, length = self.length; i < length; i++) {
        var char = self.charAt(i);
        var sub = subs[char]
        if (inverse) {
          if (sub == null) {
            if (last_substitute == null) {
              new_str += global_sub;
              last_substitute = true;
            }
          }
          else {
            new_str += char;
            last_substitute = null;
          }
        }
        else {
          if (sub != null) {
            if (last_substitute == null || last_substitute !== sub) {
              new_str += sub;
              last_substitute = sub;
            }
          }
          else {
            new_str += char;
            last_substitute = null;
          }
        }
      }
      return new_str;
    ;
    };

    def.$upcase = function() {
      var self = this;
      return self.toUpperCase();
    };

    def.$freeze = function() {
      var self = this;
      return self;
    };

    return (def['$frozen?'] = function() {
      var self = this;
      return true;
    }, nil);
  })(self, null);
  return $opal.cdecl($scope, 'Symbol', (($a = $scope.String) == null ? $opal.cm('String') : $a));
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/string.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $gvars = $opal.gvars;
  $opal.add_stubs(['$attr_reader', '$pre_match', '$post_match', '$[]', '$===', '$==', '$raise', '$inspect']);
  return (function($base, $super) {
    function $MatchData(){};
    var self = $MatchData = $klass($base, $super, 'MatchData', $MatchData);

    var def = $MatchData._proto, $scope = $MatchData._scope, TMP_1;
    def.string = def.matches = def.begin = nil;
    self.$attr_reader("post_match", "pre_match", "regexp", "string");

    $opal.defs(self, '$new', TMP_1 = function(regexp, match_groups) {
      var self = this, $iter = TMP_1._p, $yield = $iter || nil, data = nil;
      TMP_1._p = null;
      data = $opal.find_super_dispatcher(self, 'new', TMP_1, null, $MatchData).apply(self, [regexp, match_groups]);
      $gvars["`"] = data.$pre_match();
      $gvars["'"] = data.$post_match();
      $gvars["~"] = data;
      return data;
    });

    def.$initialize = function(regexp, match_groups) {
      var self = this;
      self.regexp = regexp;
      self.begin = match_groups.index;
      self.string = match_groups.input;
      self.pre_match = self.string.substr(0, regexp.lastIndex - match_groups[0].length);
      self.post_match = self.string.substr(regexp.lastIndex);
      self.matches = [];
      
      for (var i = 0, length = match_groups.length; i < length; i++) {
        var group = match_groups[i];

        if (group == null) {
          self.matches.push(nil);
        }
        else {
          self.matches.push(group);
        }
      }
    
    };

    def['$[]'] = function(args) {
      var $a, self = this;
      args = $slice.call(arguments, 0);
      return ($a = self.matches)['$[]'].apply($a, [].concat(args));
    };

    def['$=='] = function(other) {
      var $a, $b, $c, $d, self = this;
      if (($a = (($b = $scope.MatchData) == null ? $opal.cm('MatchData') : $b)['$==='](other)) === false || $a === nil) {
        return false};
      return ($a = ($b = ($c = ($d = self.string == other.string, $d !== false && $d !== nil ?self.regexp == other.regexp : $d), $c !== false && $c !== nil ?self.pre_match == other.pre_match : $c), $b !== false && $b !== nil ?self.post_match == other.post_match : $b), $a !== false && $a !== nil ?self.begin == other.begin : $a);
    };

    def.$begin = function(pos) {
      var $a, $b, $c, self = this;
      if (($a = ($b = ($c = pos['$=='](0), ($c === nil || $c === false)), $b !== false && $b !== nil ?($c = pos['$=='](1), ($c === nil || $c === false)) : $b)) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "MatchData#begin only supports 0th element")};
      return self.begin;
    };

    def.$captures = function() {
      var self = this;
      return self.matches.slice(1);
    };

    def.$inspect = function() {
      var self = this;
      
      var str = "#<MatchData " + (self.matches[0]).$inspect();

      for (var i = 1, length = self.matches.length; i < length; i++) {
        str += " " + i + ":" + (self.matches[i]).$inspect();
      }

      return str + ">";
    ;
    };

    def.$length = function() {
      var self = this;
      return self.matches.length;
    };

    $opal.defn(self, '$size', def.$length);

    def.$to_a = function() {
      var self = this;
      return self.matches;
    };

    def.$to_s = function() {
      var self = this;
      return self.matches[0];
    };

    return (def.$values_at = function(indexes) {
      var self = this;
      indexes = $slice.call(arguments, 0);
      
      var values       = [],
          match_length = self.matches.length;

      for (var i = 0, length = indexes.length; i < length; i++) {
        var pos = indexes[i];

        if (pos >= 0) {
          values.push(self.matches[pos]);
        }
        else {
          pos += match_length;

          if (pos > 0) {
            values.push(self.matches[pos]);
          }
          else {
            values.push(nil);
          }
        }
      }

      return values;
    ;
    }, nil);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/match_data.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, $b, TMP_4, $c, TMP_6, $d, TMP_8, $e, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $hash2 = $opal.hash2;
  $opal.add_stubs(['$+', '$[]', '$new', '$to_proc', '$each', '$const_set', '$sub', '$===', '$const_get', '$==', '$name', '$include?', '$names', '$constants', '$raise', '$attr_accessor', '$attr_reader', '$register', '$length', '$bytes', '$to_a', '$each_byte', '$bytesize', '$enum_for', '$find', '$getbyte']);
  (function($base, $super) {
    function $Encoding(){};
    var self = $Encoding = $klass($base, $super, 'Encoding', $Encoding);

    var def = $Encoding._proto, $scope = $Encoding._scope, TMP_1;
    def.ascii = def.dummy = def.name = nil;
    $opal.defs(self, '$register', TMP_1 = function(name, options) {
      var $a, $b, $c, TMP_2, self = this, $iter = TMP_1._p, block = $iter || nil, names = nil, encoding = nil;
      if (options == null) {
        options = $hash2([], {})
      }
      TMP_1._p = null;
      names = [name]['$+']((((($a = options['$[]']("aliases")) !== false && $a !== nil) ? $a : [])));
      encoding = ($a = ($b = (($c = $scope.Class) == null ? $opal.cm('Class') : $c)).$new, $a._p = block.$to_proc(), $a).call($b, self).$new(name, names, ((($a = options['$[]']("ascii")) !== false && $a !== nil) ? $a : false), ((($a = options['$[]']("dummy")) !== false && $a !== nil) ? $a : false));
      return ($a = ($c = names).$each, $a._p = (TMP_2 = function(name){var self = TMP_2._s || this;if (name == null) name = nil;
      return self.$const_set(name.$sub("-", "_"), encoding)}, TMP_2._s = self, TMP_2), $a).call($c);
    });

    $opal.defs(self, '$find', function(name) {try {

      var $a, $b, TMP_3, self = this;
      if (($a = self['$==='](name)) !== false && $a !== nil) {
        return name};
      ($a = ($b = self.$constants()).$each, $a._p = (TMP_3 = function(const$){var self = TMP_3._s || this, $a, $b, encoding = nil;if (const$ == null) const$ = nil;
      encoding = self.$const_get(const$);
        if (($a = ((($b = encoding.$name()['$=='](name)) !== false && $b !== nil) ? $b : encoding.$names()['$include?'](name))) !== false && $a !== nil) {
          $opal.$return(encoding)
          } else {
          return nil
        };}, TMP_3._s = self, TMP_3), $a).call($b);
      return self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "unknown encoding name - " + (name));
      } catch ($returner) { if ($returner === $opal.returner) { return $returner.$v } throw $returner; }
    });

    (function(self) {
      var $scope = self._scope, def = self._proto;
      return self.$attr_accessor("default_external")
    })(self.$singleton_class());

    self.$attr_reader("name", "names");

    def.$initialize = function(name, names, ascii, dummy) {
      var self = this;
      self.name = name;
      self.names = names;
      self.ascii = ascii;
      return self.dummy = dummy;
    };

    def['$ascii_compatible?'] = function() {
      var self = this;
      return self.ascii;
    };

    def['$dummy?'] = function() {
      var self = this;
      return self.dummy;
    };

    def.$to_s = function() {
      var self = this;
      return self.name;
    };

    def.$inspect = function() {
      var $a, self = this;
      return "#<Encoding:" + (self.name) + ((function() {if (($a = self.dummy) !== false && $a !== nil) {
        return " (dummy)"
        } else {
        return nil
      }; return nil; })()) + ">";
    };

    def.$each_byte = function() {
      var $a, self = this;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$getbyte = function() {
      var $a, self = this;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    return (def.$bytesize = function() {
      var $a, self = this;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    }, nil);
  })(self, null);
  ($a = ($b = (($c = $scope.Encoding) == null ? $opal.cm('Encoding') : $c)).$register, $a._p = (TMP_4 = function(){var self = TMP_4._s || this, TMP_5;
  $opal.defn(self, '$each_byte', TMP_5 = function(string) {
      var $a, self = this, $iter = TMP_5._p, block = $iter || nil;
      TMP_5._p = null;
      
      for (var i = 0, length = string.length; i < length; i++) {
        var code = string.charCodeAt(i);

        if (code <= 0x7f) {
          ((($a = $opal.$yield1(block, code)) === $breaker) ? $breaker.$v : $a);
        }
        else {
          var encoded = encodeURIComponent(string.charAt(i)).substr(1).split('%');

          for (var j = 0, encoded_length = encoded.length; j < encoded_length; j++) {
            ((($a = $opal.$yield1(block, parseInt(encoded[j], 16))) === $breaker) ? $breaker.$v : $a);
          }
        }
      }
    
    });
    return ($opal.defn(self, '$bytesize', function() {
      var self = this;
      return self.$bytes().$length();
    }), nil);}, TMP_4._s = self, TMP_4), $a).call($b, "UTF-8", $hash2(["aliases", "ascii"], {"aliases": ["CP65001"], "ascii": true}));
  ($a = ($c = (($d = $scope.Encoding) == null ? $opal.cm('Encoding') : $d)).$register, $a._p = (TMP_6 = function(){var self = TMP_6._s || this, TMP_7;
  $opal.defn(self, '$each_byte', TMP_7 = function(string) {
      var $a, self = this, $iter = TMP_7._p, block = $iter || nil;
      TMP_7._p = null;
      
      for (var i = 0, length = string.length; i < length; i++) {
        var code = string.charCodeAt(i);

        ((($a = $opal.$yield1(block, code & 0xff)) === $breaker) ? $breaker.$v : $a);
        ((($a = $opal.$yield1(block, code >> 8)) === $breaker) ? $breaker.$v : $a);
      }
    
    });
    return ($opal.defn(self, '$bytesize', function() {
      var self = this;
      return self.$bytes().$length();
    }), nil);}, TMP_6._s = self, TMP_6), $a).call($c, "UTF-16LE");
  ($a = ($d = (($e = $scope.Encoding) == null ? $opal.cm('Encoding') : $e)).$register, $a._p = (TMP_8 = function(){var self = TMP_8._s || this, TMP_9;
  $opal.defn(self, '$each_byte', TMP_9 = function(string) {
      var $a, self = this, $iter = TMP_9._p, block = $iter || nil;
      TMP_9._p = null;
      
      for (var i = 0, length = string.length; i < length; i++) {
        ((($a = $opal.$yield1(block, string.charCodeAt(i) & 0xff)) === $breaker) ? $breaker.$v : $a);
      }
    
    });
    return ($opal.defn(self, '$bytesize', function() {
      var self = this;
      return self.$bytes().$length();
    }), nil);}, TMP_8._s = self, TMP_8), $a).call($d, "ASCII-8BIT", $hash2(["aliases", "ascii"], {"aliases": ["BINARY"], "ascii": true}));
  return (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = $String._proto, $scope = $String._scope, $a, $b, TMP_10;
    def.encoding = nil;
    def.encoding = (($a = ((($b = $scope.Encoding) == null ? $opal.cm('Encoding') : $b))._scope).UTF_16LE == null ? $a.cm('UTF_16LE') : $a.UTF_16LE);

    def.$bytes = function() {
      var self = this;
      return self.$each_byte().$to_a();
    };

    def.$bytesize = function() {
      var self = this;
      return self.encoding.$bytesize(self);
    };

    def.$each_byte = TMP_10 = function() {
      var $a, $b, self = this, $iter = TMP_10._p, block = $iter || nil;
      TMP_10._p = null;
      if (block === nil) {
        return self.$enum_for("each_byte")};
      ($a = ($b = self.encoding).$each_byte, $a._p = block.$to_proc(), $a).call($b, self);
      return self;
    };

    def.$encoding = function() {
      var self = this;
      return self.encoding;
    };

    def.$force_encoding = function(encoding) {
      var $a, self = this;
      encoding = (($a = $scope.Encoding) == null ? $opal.cm('Encoding') : $a).$find(encoding);
      if (encoding['$=='](self.encoding)) {
        return self};
      
      var result = new native_string(self);
      result.encoding = encoding;

      return result;
    
    };

    return (def.$getbyte = function(idx) {
      var self = this;
      return self.encoding.$getbyte(self, idx);
    }, nil);
  })(self, null);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/encoding.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$include', '$undef_method', '$coerce', '$===', '$raise', '$class', '$__send__', '$send_coerced', '$to_int', '$respond_to?', '$==', '$enum_for', '$<', '$>', '$floor', '$/', '$%']);
  (function($base, $super) {
    function $Numeric(){};
    var self = $Numeric = $klass($base, $super, 'Numeric', $Numeric);

    var def = $Numeric._proto, $scope = $Numeric._scope, $a, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5;
    self.$include((($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a));

    def._isNumber = true;

    (function(self) {
      var $scope = self._scope, def = self._proto;
      return self.$undef_method("new")
    })(self.$singleton_class());

    def.$coerce = function(other, type) {
      var $a, self = this, $case = nil;
      if (type == null) {
        type = "operation"
      }
      try {
      
      if (other._isNumber) {
        return [self, other];
      }
      else {
        return other.$coerce(self);
      }
    
      } catch ($err) {if (true) {
        return (function() {$case = type;if ("operation"['$===']($case)) {return self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "" + (other.$class()) + " can't be coerce into Numeric")}else if ("comparison"['$===']($case)) {return self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")}else { return nil }})()
        }else { throw $err; }
      };
    };

    def.$send_coerced = function(method, other) {
      var $a, self = this, type = nil, $case = nil, a = nil, b = nil;
      type = (function() {$case = method;if ("+"['$===']($case) || "-"['$===']($case) || "*"['$===']($case) || "/"['$===']($case) || "%"['$===']($case) || "&"['$===']($case) || "|"['$===']($case) || "^"['$===']($case) || "**"['$===']($case)) {return "operation"}else if (">"['$===']($case) || ">="['$===']($case) || "<"['$===']($case) || "<="['$===']($case) || "<=>"['$===']($case)) {return "comparison"}else { return nil }})();
      $a = $opal.to_ary(self.$coerce(other, type)), a = ($a[0] == null ? nil : $a[0]), b = ($a[1] == null ? nil : $a[1]);
      return a.$__send__(method, b);
    };

    def['$+'] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self + other;
      }
      else {
        return self.$send_coerced("+", other);
      }
    
    };

    def['$-'] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self - other;
      }
      else {
        return self.$send_coerced("-", other);
      }
    
    };

    def['$*'] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self * other;
      }
      else {
        return self.$send_coerced("*", other);
      }
    
    };

    def['$/'] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self / other;
      }
      else {
        return self.$send_coerced("/", other);
      }
    
    };

    def['$%'] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        if (other < 0 || self < 0) {
          return (self % other + other) % other;
        }
        else {
          return self % other;
        }
      }
      else {
        return self.$send_coerced("%", other);
      }
    
    };

    def['$&'] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self & other;
      }
      else {
        return self.$send_coerced("&", other);
      }
    
    };

    def['$|'] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self | other;
      }
      else {
        return self.$send_coerced("|", other);
      }
    
    };

    def['$^'] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self ^ other;
      }
      else {
        return self.$send_coerced("^", other);
      }
    
    };

    def['$<'] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self < other;
      }
      else {
        return self.$send_coerced("<", other);
      }
    
    };

    def['$<='] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self <= other;
      }
      else {
        return self.$send_coerced("<=", other);
      }
    
    };

    def['$>'] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self > other;
      }
      else {
        return self.$send_coerced(">", other);
      }
    
    };

    def['$>='] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self >= other;
      }
      else {
        return self.$send_coerced(">=", other);
      }
    
    };

    def['$<=>'] = function(other) {
      var $a, self = this;
      try {
      
      if (other._isNumber) {
        return self > other ? 1 : (self < other ? -1 : 0);
      }
      else {
        return self.$send_coerced("<=>", other);
      }
    
      } catch ($err) {if ((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a)['$===']($err)) {
        return nil
        }else { throw $err; }
      };
    };

    def['$<<'] = function(count) {
      var self = this;
      return self << count.$to_int();
    };

    def['$>>'] = function(count) {
      var self = this;
      return self >> count.$to_int();
    };

    def['$+@'] = function() {
      var self = this;
      return +self;
    };

    def['$-@'] = function() {
      var self = this;
      return -self;
    };

    def['$~'] = function() {
      var self = this;
      return ~self;
    };

    def['$**'] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return Math.pow(self, other);
      }
      else {
        return self.$send_coerced("**", other);
      }
    
    };

    def['$=='] = function(other) {
      var self = this;
      
      if (other._isNumber) {
        return self == Number(other);
      }
      else if (other['$respond_to?']("==")) {
        return other['$=='](self);
      }
      else {
        return false;
      }
    ;
    };

    def.$abs = function() {
      var self = this;
      return Math.abs(self);
    };

    def.$ceil = function() {
      var self = this;
      return Math.ceil(self);
    };

    def.$chr = function() {
      var self = this;
      return String.fromCharCode(self);
    };

    def.$conj = function() {
      var self = this;
      return self;
    };

    $opal.defn(self, '$conjugate', def.$conj);

    def.$downto = TMP_1 = function(finish) {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil;
      TMP_1._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("downto", finish)};
      
      for (var i = self; i >= finish; i--) {
        if (block(i) === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    $opal.defn(self, '$eql?', def['$==']);

    $opal.defn(self, '$equal?', def['$==']);

    def['$even?'] = function() {
      var self = this;
      return self % 2 === 0;
    };

    def.$floor = function() {
      var self = this;
      return Math.floor(self);
    };

    def.$hash = function() {
      var self = this;
      return self.toString();
    };

    def['$integer?'] = function() {
      var self = this;
      return self % 1 === 0;
    };

    def['$is_a?'] = TMP_2 = function(klass) {var $zuper = $slice.call(arguments, 0);
      var $a, $b, $c, self = this, $iter = TMP_2._p, $yield = $iter || nil;
      TMP_2._p = null;
      if (($a = (($b = klass['$==']((($c = $scope.Float) == null ? $opal.cm('Float') : $c))) ? (($c = $scope.Float) == null ? $opal.cm('Float') : $c)['$==='](self) : $b)) !== false && $a !== nil) {
        return true};
      if (($a = (($b = klass['$==']((($c = $scope.Integer) == null ? $opal.cm('Integer') : $c))) ? (($c = $scope.Integer) == null ? $opal.cm('Integer') : $c)['$==='](self) : $b)) !== false && $a !== nil) {
        return true};
      return $opal.find_super_dispatcher(self, 'is_a?', TMP_2, $iter).apply(self, $zuper);
    };

    $opal.defn(self, '$magnitude', def.$abs);

    $opal.defn(self, '$modulo', def['$%']);

    def.$next = function() {
      var self = this;
      return self + 1;
    };

    def['$nonzero?'] = function() {
      var self = this;
      return self == 0 ? nil : self;
    };

    def['$odd?'] = function() {
      var self = this;
      return self % 2 !== 0;
    };

    def.$ord = function() {
      var self = this;
      return self;
    };

    def.$pred = function() {
      var self = this;
      return self - 1;
    };

    def.$step = TMP_3 = function(limit, step) {
      var $a, self = this, $iter = TMP_3._p, block = $iter || nil;
      if (step == null) {
        step = 1
      }
      TMP_3._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("step", limit, step)};
      if (($a = step == 0) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "step cannot be 0")};
      
      var value = self;

      if (step > 0) {
        while (value <= limit) {
          block(value);
          value += step;
        }
      }
      else {
        while (value >= limit) {
          block(value);
          value += step;
        }
      }
    
      return self;
    };

    $opal.defn(self, '$succ', def.$next);

    def.$times = TMP_4 = function() {
      var $a, self = this, $iter = TMP_4._p, block = $iter || nil;
      TMP_4._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("times")};
      
      for (var i = 0; i < self; i++) {
        if (block(i) === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def.$to_f = function() {
      var self = this;
      return parseFloat(self);
    };

    def.$to_i = function() {
      var self = this;
      return parseInt(self);
    };

    $opal.defn(self, '$to_int', def.$to_i);

    def.$to_s = function(base) {
      var $a, $b, self = this;
      if (base == null) {
        base = 10
      }
      if (($a = ((($b = base['$<'](2)) !== false && $b !== nil) ? $b : base['$>'](36))) !== false && $a !== nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "base must be between 2 and 36")};
      return self.toString(base);
    };

    $opal.defn(self, '$inspect', def.$to_s);

    def.$divmod = function(rhs) {
      var self = this, q = nil, r = nil;
      q = (self['$/'](rhs)).$floor();
      r = self['$%'](rhs);
      return [q, r];
    };

    def.$upto = TMP_5 = function(finish) {
      var $a, self = this, $iter = TMP_5._p, block = $iter || nil;
      TMP_5._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("upto", finish)};
      
      for (var i = self; i <= finish; i++) {
        if (block(i) === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def['$zero?'] = function() {
      var self = this;
      return self == 0;
    };

    def.$size = function() {
      var self = this;
      return 4;
    };

    def['$nan?'] = function() {
      var self = this;
      return isNaN(self);
    };

    def['$finite?'] = function() {
      var self = this;
      return self == Infinity || self == -Infinity;
    };

    return (def['$infinite?'] = function() {
      var $a, self = this;
      if (($a = self == Infinity) !== false && $a !== nil) {
        return +1;
      } else if (($a = self == -Infinity) !== false && $a !== nil) {
        return -1;
        } else {
        return nil
      };
    }, nil);
  })(self, null);
  $opal.cdecl($scope, 'Fixnum', (($a = $scope.Numeric) == null ? $opal.cm('Numeric') : $a));
  (function($base, $super) {
    function $Integer(){};
    var self = $Integer = $klass($base, $super, 'Integer', $Integer);

    var def = $Integer._proto, $scope = $Integer._scope;
    return ($opal.defs(self, '$===', function(other) {
      var self = this;
      return !!(other._isNumber && (other % 1) == 0);
    }), nil)
  })(self, (($a = $scope.Numeric) == null ? $opal.cm('Numeric') : $a));
  return (function($base, $super) {
    function $Float(){};
    var self = $Float = $klass($base, $super, 'Float', $Float);

    var def = $Float._proto, $scope = $Float._scope;
    $opal.defs(self, '$===', function(other) {
      var self = this;
      return !!(other._isNumber && (other % 1) != 0);
    });

    $opal.cdecl($scope, 'INFINITY', Infinity);

    return $opal.cdecl($scope, 'NAN', NaN);
  })(self, (($a = $scope.Numeric) == null ? $opal.cm('Numeric') : $a));
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/numeric.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$raise']);
  return (function($base, $super) {
    function $Proc(){};
    var self = $Proc = $klass($base, $super, 'Proc', $Proc);

    var def = $Proc._proto, $scope = $Proc._scope, TMP_1, TMP_2;
    def._isProc = true;

    def.is_lambda = false;

    $opal.defs(self, '$new', TMP_1 = function() {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil;
      TMP_1._p = null;
      if (($a = block) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to create a Proc object without a block")};
      return block;
    });

    def.$call = TMP_2 = function(args) {
      var self = this, $iter = TMP_2._p, block = $iter || nil;
      args = $slice.call(arguments, 0);
      TMP_2._p = null;
      
      if (block !== nil) {
        self._p = block;
      }

      var result;

      if (self.is_lambda) {
        result = self.apply(null, args);
      }
      else {
        result = Opal.$yieldX(self, args);
      }

      if (result === $breaker) {
        return $breaker.$v;
      }

      return result;
    
    };

    $opal.defn(self, '$[]', def.$call);

    def.$to_proc = function() {
      var self = this;
      return self;
    };

    def['$lambda?'] = function() {
      var self = this;
      return !!self.is_lambda;
    };

    return (def.$arity = function() {
      var self = this;
      return self.length;
    }, nil);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/proc.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$attr_reader', '$class', '$arity', '$new', '$name']);
  (function($base, $super) {
    function $Method(){};
    var self = $Method = $klass($base, $super, 'Method', $Method);

    var def = $Method._proto, $scope = $Method._scope, TMP_1;
    def.method = def.receiver = def.owner = def.name = def.obj = nil;
    self.$attr_reader("owner", "receiver", "name");

    def.$initialize = function(receiver, method, name) {
      var self = this;
      self.receiver = receiver;
      self.owner = receiver.$class();
      self.name = name;
      return self.method = method;
    };

    def.$arity = function() {
      var self = this;
      return self.method.$arity();
    };

    def.$call = TMP_1 = function(args) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;
      args = $slice.call(arguments, 0);
      TMP_1._p = null;
      
      self.method._p = block;

      return self.method.apply(self.receiver, args);
    ;
    };

    $opal.defn(self, '$[]', def.$call);

    def.$unbind = function() {
      var $a, self = this;
      return (($a = $scope.UnboundMethod) == null ? $opal.cm('UnboundMethod') : $a).$new(self.owner, self.method, self.name);
    };

    def.$to_proc = function() {
      var self = this;
      return self.method;
    };

    return (def.$inspect = function() {
      var self = this;
      return "#<Method: " + (self.obj.$class().$name()) + "#" + (self.name) + "}>";
    }, nil);
  })(self, null);
  return (function($base, $super) {
    function $UnboundMethod(){};
    var self = $UnboundMethod = $klass($base, $super, 'UnboundMethod', $UnboundMethod);

    var def = $UnboundMethod._proto, $scope = $UnboundMethod._scope;
    def.method = def.name = def.owner = nil;
    self.$attr_reader("owner", "name");

    def.$initialize = function(owner, method, name) {
      var self = this;
      self.owner = owner;
      self.method = method;
      return self.name = name;
    };

    def.$arity = function() {
      var self = this;
      return self.method.$arity();
    };

    def.$bind = function(object) {
      var $a, self = this;
      return (($a = $scope.Method) == null ? $opal.cm('Method') : $a).$new(object, self.method, self.name);
    };

    return (def.$inspect = function() {
      var self = this;
      return "#<UnboundMethod: " + (self.owner.$name()) + "#" + (self.name) + ">";
    }, nil);
  })(self, null);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/method.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$include', '$attr_reader', '$include?', '$<=', '$<', '$enum_for', '$succ', '$==', '$===', '$exclude_end?', '$eql?', '$begin', '$end', '$cover?', '$raise', '$inspect']);
  return (function($base, $super) {
    function $Range(){};
    var self = $Range = $klass($base, $super, 'Range', $Range);

    var def = $Range._proto, $scope = $Range._scope, $a, TMP_1, TMP_2, TMP_3;
    def.begin = def.exclude = def.end = nil;
    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    def._isRange = true;

    self.$attr_reader("begin", "end");

    def.$initialize = function(first, last, exclude) {
      var self = this;
      if (exclude == null) {
        exclude = false
      }
      self.begin = first;
      self.end = last;
      return self.exclude = exclude;
    };

    def['$=='] = function(other) {
      var self = this;
      
      if (!other._isRange) {
        return false;
      }

      return self.exclude === other.exclude &&
             self.begin   ==  other.begin &&
             self.end     ==  other.end;
    
    };

    def['$==='] = function(obj) {
      var self = this;
      return self['$include?'](obj);
    };

    def['$cover?'] = function(value) {
      var $a, $b, self = this;
      return (($a = self.begin['$<='](value)) ? ((function() {if (($b = self.exclude) !== false && $b !== nil) {
        return value['$<'](self.end)
        } else {
        return value['$<='](self.end)
      }; return nil; })()) : $a);
    };

    $opal.defn(self, '$last', def.$end);

    def.$each = TMP_1 = function() {
      var $a, $b, $c, self = this, $iter = TMP_1._p, block = $iter || nil, current = nil, last = nil;
      TMP_1._p = null;
      if (block === nil) {
        return self.$enum_for("each")};
      current = self.begin;
      last = self.end;
      while (current['$<'](last)) {
      if ($opal.$yield1(block, current) === $breaker) return $breaker.$v;
      current = current.$succ();};
      if (($a = ($b = ($c = self.exclude, ($c === nil || $c === false)), $b !== false && $b !== nil ?current['$=='](last) : $b)) !== false && $a !== nil) {
        if ($opal.$yield1(block, current) === $breaker) return $breaker.$v};
      return self;
    };

    def['$eql?'] = function(other) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Range) == null ? $opal.cm('Range') : $b)['$==='](other)) === false || $a === nil) {
        return false};
      return ($a = ($b = self.exclude['$==='](other['$exclude_end?']()), $b !== false && $b !== nil ?self.begin['$eql?'](other.$begin()) : $b), $a !== false && $a !== nil ?self.end['$eql?'](other.$end()) : $a);
    };

    def['$exclude_end?'] = function() {
      var self = this;
      return self.exclude;
    };

    $opal.defn(self, '$first', def.$begin);

    def['$include?'] = function(obj) {
      var self = this;
      return self['$cover?'](obj);
    };

    def.$max = TMP_2 = function() {var $zuper = $slice.call(arguments, 0);
      var self = this, $iter = TMP_2._p, $yield = $iter || nil;
      TMP_2._p = null;
      if (($yield !== nil)) {
        return $opal.find_super_dispatcher(self, 'max', TMP_2, $iter).apply(self, $zuper)
        } else {
        return self.exclude ? self.end - 1 : self.end;
      };
    };

    def.$min = TMP_3 = function() {var $zuper = $slice.call(arguments, 0);
      var self = this, $iter = TMP_3._p, $yield = $iter || nil;
      TMP_3._p = null;
      if (($yield !== nil)) {
        return $opal.find_super_dispatcher(self, 'min', TMP_3, $iter).apply(self, $zuper)
        } else {
        return self.begin
      };
    };

    $opal.defn(self, '$member?', def['$include?']);

    def.$step = function(n) {
      var $a, self = this;
      if (n == null) {
        n = 1
      }
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$to_s = function() {
      var self = this;
      return self.begin.$inspect() + (self.exclude ? '...' : '..') + self.end.$inspect();
    };

    return $opal.defn(self, '$inspect', def.$to_s);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/range.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$include', '$raise', '$kind_of?', '$to_i', '$coerce_to', '$between?', '$new', '$compact', '$nil?', '$===', '$<=>', '$to_f', '$is_a?', '$zero?', '$warn', '$yday', '$rjust', '$ljust', '$zone', '$strftime', '$sec', '$min', '$hour', '$day', '$month', '$year', '$wday', '$isdst']);
  (function($base, $super) {
    function $Time(){};
    var self = $Time = $klass($base, $super, 'Time', $Time);

    var def = $Time._proto, $scope = $Time._scope, $a;
    self.$include((($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a));

    
    var days_of_week = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        short_days   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        short_months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        long_months  = ["January", "Febuary", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  ;

    $opal.defs(self, '$at', function(seconds, frac) {
      var self = this;
      if (frac == null) {
        frac = 0
      }
      return new Date(seconds * 1000 + frac);
    });

    $opal.defs(self, '$new', function(year, month, day, hour, minute, second, utc_offset) {
      var $a, self = this;
      
      switch (arguments.length) {
        case 1:
          return new Date(year, 0);

        case 2:
          return new Date(year, month - 1);

        case 3:
          return new Date(year, month - 1, day);

        case 4:
          return new Date(year, month - 1, day, hour);

        case 5:
          return new Date(year, month - 1, day, hour, minute);

        case 6:
          return new Date(year, month - 1, day, hour, minute, second);

        case 7:
          self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));

        default:
          return new Date();
      }
    
    });

    $opal.defs(self, '$local', function(year, month, day, hour, minute, second, millisecond) {
      var $a, $b, self = this;
      if (month == null) {
        month = nil
      }
      if (day == null) {
        day = nil
      }
      if (hour == null) {
        hour = nil
      }
      if (minute == null) {
        minute = nil
      }
      if (second == null) {
        second = nil
      }
      if (millisecond == null) {
        millisecond = nil
      }
      if (($a = arguments.length === 10) !== false && $a !== nil) {
        
        var args = $slice.call(arguments).reverse();

        second = args[9];
        minute = args[8];
        hour   = args[7];
        day    = args[6];
        month  = args[5];
        year   = args[4];
      };
      year = (function() {if (($a = year['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== false && $a !== nil) {
        return year.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(year, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      month = (function() {if (($a = month['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== false && $a !== nil) {
        return month.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(((($a = month) !== false && $a !== nil) ? $a : 1), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      if (($a = month['$between?'](1, 12)) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "month out of range: " + (month))};
      day = (function() {if (($a = day['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== false && $a !== nil) {
        return day.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(((($a = day) !== false && $a !== nil) ? $a : 1), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      if (($a = day['$between?'](1, 31)) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "day out of range: " + (day))};
      hour = (function() {if (($a = hour['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== false && $a !== nil) {
        return hour.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(((($a = hour) !== false && $a !== nil) ? $a : 0), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      if (($a = hour['$between?'](0, 24)) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "hour out of range: " + (hour))};
      minute = (function() {if (($a = minute['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== false && $a !== nil) {
        return minute.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(((($a = minute) !== false && $a !== nil) ? $a : 0), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      if (($a = minute['$between?'](0, 59)) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "minute out of range: " + (minute))};
      second = (function() {if (($a = second['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== false && $a !== nil) {
        return second.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(((($a = second) !== false && $a !== nil) ? $a : 0), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      if (($a = second['$between?'](0, 59)) === false || $a === nil) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "second out of range: " + (second))};
      return ($a = self).$new.apply($a, [].concat([year, month, day, hour, minute, second].$compact()));
    });

    $opal.defs(self, '$gm', function(year, month, day, hour, minute, second, utc_offset) {
      var $a, self = this;
      if (($a = year['$nil?']()) !== false && $a !== nil) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "missing year (got nil)")};
      
      switch (arguments.length) {
        case 1:
          return new Date(Date.UTC(year, 0));

        case 2:
          return new Date(Date.UTC(year, month - 1));

        case 3:
          return new Date(Date.UTC(year, month - 1, day));

        case 4:
          return new Date(Date.UTC(year, month - 1, day, hour));

        case 5:
          return new Date(Date.UTC(year, month - 1, day, hour, minute));

        case 6:
          return new Date(Date.UTC(year, month - 1, day, hour, minute, second));

        case 7:
          self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
      }
    
    });

    (function(self) {
      var $scope = self._scope, def = self._proto;
      self._proto.$mktime = self._proto.$local;
      return self._proto.$utc = self._proto.$gm;
    })(self.$singleton_class());

    $opal.defs(self, '$now', function() {
      var self = this;
      return new Date();
    });

    def['$+'] = function(other) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Time) == null ? $opal.cm('Time') : $b)['$==='](other)) !== false && $a !== nil) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "time + time?")};
      other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      return new Date(self.getTime() + (other * 1000));
    };

    def['$-'] = function(other) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Time) == null ? $opal.cm('Time') : $b)['$==='](other)) !== false && $a !== nil) {
        return (self.getTime() - other.getTime()) / 1000;
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        return new Date(self.getTime() - (other * 1000));
      };
    };

    def['$<=>'] = function(other) {
      var self = this;
      return self.$to_f()['$<=>'](other.$to_f());
    };

    def['$=='] = function(other) {
      var self = this;
      return self.$to_f() === other.$to_f();
    };

    def.$day = function() {
      var self = this;
      return self.getDate();
    };

    def.$yday = function() {
      var self = this;
      
      // http://javascript.about.com/library/bldayyear.htm
      var onejan = new Date(self.getFullYear(), 0, 1);
      return Math.ceil((self - onejan) / 86400000);
    
    };

    def.$isdst = function() {
      var $a, self = this;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def['$eql?'] = function(other) {
      var $a, $b, self = this;
      return ($a = other['$is_a?']((($b = $scope.Time) == null ? $opal.cm('Time') : $b)), $a !== false && $a !== nil ?(self['$<=>'](other))['$zero?']() : $a);
    };

    def['$friday?'] = function() {
      var self = this;
      return self.getDay() === 5;
    };

    def.$hour = function() {
      var self = this;
      return self.getHours();
    };

    def.$inspect = function() {
      var self = this;
      return self.toString();
    };

    $opal.defn(self, '$mday', def.$day);

    def.$min = function() {
      var self = this;
      return self.getMinutes();
    };

    def.$mon = function() {
      var self = this;
      return self.getMonth() + 1;
    };

    def['$monday?'] = function() {
      var self = this;
      return self.getDay() === 1;
    };

    $opal.defn(self, '$month', def.$mon);

    def['$saturday?'] = function() {
      var self = this;
      return self.getDay() === 6;
    };

    def.$sec = function() {
      var self = this;
      return self.getSeconds();
    };

    def.$usec = function() {
      var self = this;
      self.$warn("Microseconds are not supported");
      return 0;
    };

    def.$zone = function() {
      var self = this;
      
      var string = self.toString(),
          result;

      if (string.indexOf('(') == -1) {
        result = string.match(/[A-Z]{3,4}/)[0];
      }
      else {
        result = string.match(/\([^)]+\)/)[0].match(/[A-Z]/g).join('');
      }

      if (result == "GMT" && /(GMT\W*\d{4})/.test(string)) {
        return RegExp.$1;
      }
      else {
        return result;
      }
    
    };

    def.$gmt_offset = function() {
      var self = this;
      return -self.getTimezoneOffset() * 60;
    };

    def.$strftime = function(format) {
      var self = this;
      
      return format.replace(/%([\-_#^0]*:{0,2})(\d+)?([EO]*)(.)/g, function(full, flags, width, _, conv) {
        var result = "",
            width  = parseInt(width),
            zero   = flags.indexOf('0') !== -1,
            pad    = flags.indexOf('-') === -1,
            blank  = flags.indexOf('_') !== -1,
            upcase = flags.indexOf('^') !== -1,
            invert = flags.indexOf('#') !== -1,
            colons = (flags.match(':') || []).length;

        if (zero && blank) {
          if (flags.indexOf('0') < flags.indexOf('_')) {
            zero = false;
          }
          else {
            blank = false;
          }
        }

        switch (conv) {
          case 'Y':
            result += self.getFullYear();
            break;

          case 'C':
            zero    = !blank;
            result += Match.round(self.getFullYear() / 100);
            break;

          case 'y':
            zero    = !blank;
            result += (self.getFullYear() % 100);
            break;

          case 'm':
            zero    = !blank;
            result += (self.getMonth() + 1);
            break;

          case 'B':
            result += long_months[self.getMonth()];
            break;

          case 'b':
          case 'h':
            blank   = !zero;
            result += short_months[self.getMonth()];
            break;

          case 'd':
            zero    = !blank
            result += self.getDate();
            break;

          case 'e':
            blank   = !zero
            result += self.getDate();
            break;

          case 'j':
            result += self.$yday();
            break;

          case 'H':
            zero    = !blank;
            result += self.getHours();
            break;

          case 'k':
            blank   = !zero;
            result += self.getHours();
            break;

          case 'I':
            zero    = !blank;
            result += (self.getHours() % 12 || 12);
            break;

          case 'l':
            blank   = !zero;
            result += (self.getHours() % 12 || 12);
            break;

          case 'P':
            result += (self.getHours() >= 12 ? "pm" : "am");
            break;

          case 'p':
            result += (self.getHours() >= 12 ? "PM" : "AM");
            break;

          case 'M':
            zero    = !blank;
            result += self.getMinutes();
            break;

          case 'S':
            zero    = !blank;
            result += self.getSeconds();
            break;

          case 'L':
            zero    = !blank;
            width   = isNaN(width) ? 3 : width;
            result += self.getMilliseconds();
            break;

          case 'N':
            width   = isNaN(width) ? 9 : width;
            result += (self.getMilliseconds().toString()).$rjust(3, "0");
            result  = (result).$ljust(width, "0");
            break;

          case 'z':
            var offset  = self.getTimezoneOffset(),
                hours   = Math.floor(Math.abs(offset) / 60),
                minutes = Math.abs(offset) % 60;

            result += offset < 0 ? "+" : "-";
            result += hours < 10 ? "0" : "";
            result += hours;

            if (colons > 0) {
              result += ":";
            }

            result += minutes < 10 ? "0" : "";
            result += minutes;

            if (colons > 1) {
              result += ":00";
            }

            break;

          case 'Z':
            result += self.$zone();
            break;

          case 'A':
            result += days_of_week[self.getDay()];
            break;

          case 'a':
            result += short_days[self.getDay()];
            break;

          case 'u':
            result += (self.getDay() + 1);
            break;

          case 'w':
            result += self.getDay();
            break;

          // TODO: week year
          // TODO: week number

          case 's':
            result += parseInt(self.getTime() / 1000)
            break;

          case 'n':
            result += "\n";
            break;

          case 't':
            result += "\t";
            break;

          case '%':
            result += "%";
            break;

          case 'c':
            result += self.$strftime("%a %b %e %T %Y");
            break;

          case 'D':
          case 'x':
            result += self.$strftime("%m/%d/%y");
            break;

          case 'F':
            result += self.$strftime("%Y-%m-%d");
            break;

          case 'v':
            result += self.$strftime("%e-%^b-%4Y");
            break;

          case 'r':
            result += self.$strftime("%I:%M:%S %p");
            break;

          case 'R':
            result += self.$strftime("%H:%M");
            break;

          case 'T':
          case 'X':
            result += self.$strftime("%H:%M:%S");
            break;

          default:
            return full;
        }

        if (upcase) {
          result = result.toUpperCase();
        }

        if (invert) {
          result = result.replace(/[A-Z]/, function(c) { c.toLowerCase() }).
                          replace(/[a-z]/, function(c) { c.toUpperCase() });
        }

        if (pad && (zero || blank)) {
          result = (result).$rjust(isNaN(width) ? 2 : width, blank ? " " : "0");
        }

        return result;
      });
    
    };

    def['$sunday?'] = function() {
      var self = this;
      return self.getDay() === 0;
    };

    def['$thursday?'] = function() {
      var self = this;
      return self.getDay() === 4;
    };

    def.$to_a = function() {
      var self = this;
      return [self.$sec(), self.$min(), self.$hour(), self.$day(), self.$month(), self.$year(), self.$wday(), self.$yday(), self.$isdst(), self.$zone()];
    };

    def.$to_f = function() {
      var self = this;
      return self.getTime() / 1000;
    };

    def.$to_i = function() {
      var self = this;
      return parseInt(self.getTime() / 1000);
    };

    $opal.defn(self, '$to_s', def.$inspect);

    def['$tuesday?'] = function() {
      var self = this;
      return self.getDay() === 2;
    };

    def.$wday = function() {
      var self = this;
      return self.getDay();
    };

    def['$wednesday?'] = function() {
      var self = this;
      return self.getDay() === 3;
    };

    return (def.$year = function() {
      var self = this;
      return self.getFullYear();
    }, nil);
  })(self, null);
  return (function($base, $super) {
    function $Time(){};
    var self = $Time = $klass($base, $super, 'Time', $Time);

    var def = $Time._proto, $scope = $Time._scope;
    $opal.defs(self, '$parse', function(str) {
      var self = this;
      return new Date(Date.parse(str));
    });

    return (def.$iso8601 = function() {
      var self = this;
      return self.$strftime("%FT%T%z");
    }, nil);
  })(self, null);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/time.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$==', '$[]', '$upcase', '$const_set', '$new', '$unshift', '$each', '$define_struct_attribute', '$instance_eval', '$to_proc', '$raise', '$<<', '$members', '$define_method', '$instance_variable_get', '$instance_variable_set', '$include', '$each_with_index', '$class', '$===', '$>=', '$size', '$include?', '$to_sym', '$enum_for', '$hash', '$all?', '$length', '$map', '$+', '$name', '$join', '$inspect', '$each_pair']);
  return (function($base, $super) {
    function $Struct(){};
    var self = $Struct = $klass($base, $super, 'Struct', $Struct);

    var def = $Struct._proto, $scope = $Struct._scope, TMP_1, $a, TMP_8, TMP_10;
    $opal.defs(self, '$new', TMP_1 = function(name, args) {var $zuper = $slice.call(arguments, 0);
      var $a, $b, $c, TMP_2, $d, self = this, $iter = TMP_1._p, block = $iter || nil;
      args = $slice.call(arguments, 1);
      TMP_1._p = null;
      if (($a = self['$==']((($b = $scope.Struct) == null ? $opal.cm('Struct') : $b))) === false || $a === nil) {
        return $opal.find_super_dispatcher(self, 'new', TMP_1, $iter, $Struct).apply(self, $zuper)};
      if (name['$[]'](0)['$=='](name['$[]'](0).$upcase())) {
        return (($a = $scope.Struct) == null ? $opal.cm('Struct') : $a).$const_set(name, ($a = self).$new.apply($a, [].concat(args)))
        } else {
        args.$unshift(name);
        return ($b = ($c = (($d = $scope.Class) == null ? $opal.cm('Class') : $d)).$new, $b._p = (TMP_2 = function(){var self = TMP_2._s || this, $a, $b, TMP_3, $c;
        ($a = ($b = args).$each, $a._p = (TMP_3 = function(arg){var self = TMP_3._s || this;if (arg == null) arg = nil;
          return self.$define_struct_attribute(arg)}, TMP_3._s = self, TMP_3), $a).call($b);
          if (block !== false && block !== nil) {
            return ($a = ($c = self).$instance_eval, $a._p = block.$to_proc(), $a).call($c)
            } else {
            return nil
          };}, TMP_2._s = self, TMP_2), $b).call($c, self);
      };
    });

    $opal.defs(self, '$define_struct_attribute', function(name) {
      var $a, $b, TMP_4, $c, TMP_5, self = this;
      if (self['$==']((($a = $scope.Struct) == null ? $opal.cm('Struct') : $a))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "you cannot define attributes to the Struct class")};
      self.$members()['$<<'](name);
      ($a = ($b = self).$define_method, $a._p = (TMP_4 = function(){var self = TMP_4._s || this;
      return self.$instance_variable_get("@" + (name))}, TMP_4._s = self, TMP_4), $a).call($b, name);
      return ($a = ($c = self).$define_method, $a._p = (TMP_5 = function(value){var self = TMP_5._s || this;if (value == null) value = nil;
      return self.$instance_variable_set("@" + (name), value)}, TMP_5._s = self, TMP_5), $a).call($c, "" + (name) + "=");
    });

    $opal.defs(self, '$members', function() {
      var $a, self = this;
      if (self.members == null) self.members = nil;

      if (self['$==']((($a = $scope.Struct) == null ? $opal.cm('Struct') : $a))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "the Struct class has no members")};
      return ((($a = self.members) !== false && $a !== nil) ? $a : self.members = []);
    });

    $opal.defs(self, '$inherited', function(klass) {
      var $a, $b, TMP_6, self = this, members = nil;
      if (self.members == null) self.members = nil;

      if (self['$==']((($a = $scope.Struct) == null ? $opal.cm('Struct') : $a))) {
        return nil};
      members = self.members;
      return ($a = ($b = klass).$instance_eval, $a._p = (TMP_6 = function(){var self = TMP_6._s || this;
      return self.members = members}, TMP_6._s = self, TMP_6), $a).call($b);
    });

    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    def.$initialize = function(args) {
      var $a, $b, TMP_7, self = this;
      args = $slice.call(arguments, 0);
      return ($a = ($b = self.$members()).$each_with_index, $a._p = (TMP_7 = function(name, index){var self = TMP_7._s || this;if (name == null) name = nil;if (index == null) index = nil;
      return self.$instance_variable_set("@" + (name), args['$[]'](index))}, TMP_7._s = self, TMP_7), $a).call($b);
    };

    def.$members = function() {
      var self = this;
      return self.$class().$members();
    };

    def['$[]'] = function(name) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](name)) !== false && $a !== nil) {
        if (name['$>='](self.$members().$size())) {
          self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "offset " + (name) + " too large for struct(size:" + (self.$members().$size()) + ")")};
        name = self.$members()['$[]'](name);
      } else if (($a = self.$members()['$include?'](name.$to_sym())) === false || $a === nil) {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "no member '" + (name) + "' in struct")};
      return self.$instance_variable_get("@" + (name));
    };

    def['$[]='] = function(name, value) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](name)) !== false && $a !== nil) {
        if (name['$>='](self.$members().$size())) {
          self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "offset " + (name) + " too large for struct(size:" + (self.$members().$size()) + ")")};
        name = self.$members()['$[]'](name);
      } else if (($a = self.$members()['$include?'](name.$to_sym())) === false || $a === nil) {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "no member '" + (name) + "' in struct")};
      return self.$instance_variable_set("@" + (name), value);
    };

    def.$each = TMP_8 = function() {
      var $a, $b, TMP_9, self = this, $iter = TMP_8._p, $yield = $iter || nil;
      TMP_8._p = null;
      if ($yield === nil) {
        return self.$enum_for("each")};
      return ($a = ($b = self.$members()).$each, $a._p = (TMP_9 = function(name){var self = TMP_9._s || this, $a;if (name == null) name = nil;
      return $a = $opal.$yield1($yield, self['$[]'](name)), $a === $breaker ? $a : $a}, TMP_9._s = self, TMP_9), $a).call($b);
    };

    def.$each_pair = TMP_10 = function() {
      var $a, $b, TMP_11, self = this, $iter = TMP_10._p, $yield = $iter || nil;
      TMP_10._p = null;
      if ($yield === nil) {
        return self.$enum_for("each_pair")};
      return ($a = ($b = self.$members()).$each, $a._p = (TMP_11 = function(name){var self = TMP_11._s || this, $a;if (name == null) name = nil;
      return $a = $opal.$yieldX($yield, [name, self['$[]'](name)]), $a === $breaker ? $a : $a}, TMP_11._s = self, TMP_11), $a).call($b);
    };

    def['$eql?'] = function(other) {
      var $a, $b, $c, TMP_12, self = this;
      return ((($a = self.$hash()['$=='](other.$hash())) !== false && $a !== nil) ? $a : ($b = ($c = other.$each_with_index())['$all?'], $b._p = (TMP_12 = function(object, index){var self = TMP_12._s || this;if (object == null) object = nil;if (index == null) index = nil;
      return self['$[]'](self.$members()['$[]'](index))['$=='](object)}, TMP_12._s = self, TMP_12), $b).call($c));
    };

    def.$length = function() {
      var self = this;
      return self.$members().$length();
    };

    $opal.defn(self, '$size', def.$length);

    def.$to_a = function() {
      var $a, $b, TMP_13, self = this;
      return ($a = ($b = self.$members()).$map, $a._p = (TMP_13 = function(name){var self = TMP_13._s || this;if (name == null) name = nil;
      return self['$[]'](name)}, TMP_13._s = self, TMP_13), $a).call($b);
    };

    $opal.defn(self, '$values', def.$to_a);

    return (def.$inspect = function() {
      var $a, $b, TMP_14, self = this, result = nil;
      result = "#<struct ";
      if (self.$class()['$==']((($a = $scope.Struct) == null ? $opal.cm('Struct') : $a))) {
        result = result['$+']("" + (self.$class().$name()) + " ")};
      result = result['$+'](($a = ($b = self.$each_pair()).$map, $a._p = (TMP_14 = function(name, value){var self = TMP_14._s || this;if (name == null) name = nil;if (value == null) value = nil;
      return "" + (name) + "=" + (value.$inspect())}, TMP_14._s = self, TMP_14), $a).call($b).$join(", "));
      result = result['$+'](">");
      return result;
    }, nil);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/struct.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $module = $opal.module, $gvars = $opal.gvars;
  $opal.add_stubs(['$write', '$join', '$map', '$String', '$getbyte', '$getc', '$raise', '$new', '$puts', '$to_s']);
  (function($base, $super) {
    function $IO(){};
    var self = $IO = $klass($base, $super, 'IO', $IO);

    var def = $IO._proto, $scope = $IO._scope;
    $opal.cdecl($scope, 'SEEK_SET', 0);

    $opal.cdecl($scope, 'SEEK_CUR', 1);

    $opal.cdecl($scope, 'SEEK_END', 2);

    (function($base) {
      var self = $module($base, 'Writable');

      var def = self._proto, $scope = self._scope;
      def['$<<'] = function(string) {
        var self = this;
        self.$write(string);
        return self;
      };

      def.$print = function(args) {
        var $a, $b, TMP_1, self = this;
        args = $slice.call(arguments, 0);
        return self.$write(($a = ($b = args).$map, $a._p = (TMP_1 = function(arg){var self = TMP_1._s || this;if (arg == null) arg = nil;
        return self.$String(arg)}, TMP_1._s = self, TMP_1), $a).call($b).$join($gvars[","]));
      };

      def.$puts = function(args) {
        var $a, $b, TMP_2, self = this;
        args = $slice.call(arguments, 0);
        return self.$write(($a = ($b = args).$map, $a._p = (TMP_2 = function(arg){var self = TMP_2._s || this;if (arg == null) arg = nil;
        return self.$String(arg)}, TMP_2._s = self, TMP_2), $a).call($b).$join($gvars["/"]));
      };
            ;$opal.donate(self, ["$<<", "$print", "$puts"]);
    })(self);

    return (function($base) {
      var self = $module($base, 'Readable');

      var def = self._proto, $scope = self._scope;
      def.$readbyte = function() {
        var self = this;
        return self.$getbyte();
      };

      def.$readchar = function() {
        var self = this;
        return self.$getc();
      };

      def.$readline = function(sep) {
        var $a, self = this;
        if (sep == null) {
          sep = $gvars["/"]
        }
        return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
      };

      def.$readpartial = function(integer, outbuf) {
        var $a, self = this;
        if (outbuf == null) {
          outbuf = nil
        }
        return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
      };
            ;$opal.donate(self, ["$readbyte", "$readchar", "$readline", "$readpartial"]);
    })(self);
  })(self, null);
  $opal.cdecl($scope, 'STDERR', $gvars["stderr"] = (($a = $scope.IO) == null ? $opal.cm('IO') : $a).$new());
  $opal.cdecl($scope, 'STDIN', $gvars["stdin"] = (($a = $scope.IO) == null ? $opal.cm('IO') : $a).$new());
  $opal.cdecl($scope, 'STDOUT', $gvars["stdout"] = (($a = $scope.IO) == null ? $opal.cm('IO') : $a).$new());
  $opal.defs($gvars["stdout"], '$puts', function(strs) {
    var $a, self = this;
    strs = $slice.call(arguments, 0);
    
    for (var i = 0; i < strs.length; i++) {
      if (strs[i] instanceof Array) {
        ($a = self).$puts.apply($a, [].concat((strs[i])));
      }
      else {
        console.log((strs[i]).$to_s());
      }
    }
  
    return nil;
  });
  return ($opal.defs($gvars["stderr"], '$puts', function(strs) {
    var $a, self = this;
    strs = $slice.call(arguments, 0);
    
    for (var i = 0; i < strs.length; i++) {
      if (strs[i] instanceof Array) {
        ($a = self).$puts.apply($a, [].concat((strs[i])));
      }
      else {
        console.warn((strs[i]).$to_s());
      }
    }
  
    return nil;
  }), nil);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/io.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice;
  $opal.add_stubs(['$include']);
  $opal.defs(self, '$to_s', function() {
    var self = this;
    return "main";
  });
  return ($opal.defs(self, '$include', function(mod) {
    var $a, self = this;
    return (($a = $scope.Object) == null ? $opal.cm('Object') : $a).$include(mod);
  }), nil);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/corelib/main.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module, $range = $opal.range, $hash2 = $opal.hash2, $klass = $opal.klass, $gvars = $opal.gvars;
  $opal.add_stubs(['$try_convert', '$native?', '$respond_to?', '$to_n', '$raise', '$map', '$===', '$Native', '$end_with?', '$define_method', '$[]', '$convert', '$call', '$to_proc', '$new', '$extend', '$to_a', '$to_ary', '$include', '$method_missing', '$[]=', '$slice', '$-', '$length', '$==', '$enum_for', '$>=', '$<<', '$inspect', '$each', '$instance_variable_set', '$members', '$each_with_index', '$each_pair', '$name']);
  (function($base) {
    var self = $module($base, 'Native');

    var def = self._proto, $scope = self._scope, TMP_1;
    $opal.defs(self, '$is_a?', function(object, klass) {
      var $a, self = this;
      
      try {
        return object instanceof (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$try_convert(klass);
      }
      catch (e) {
        return false;
      }
    ;
    });

    $opal.defs(self, '$try_convert', function(value) {
      var self = this;
      
      if (self['$native?'](value)) {
        return value;
      }
      else if (value['$respond_to?']("to_n")) {
        return value.$to_n();
      }
      else {
        return nil;
      }
    ;
    });

    $opal.defs(self, '$convert', function(value) {
      var $a, self = this;
      
      if (self['$native?'](value)) {
        return value;
      }
      else if (value['$respond_to?']("to_n")) {
        return value.$to_n();
      }
      else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "the passed value isn't a native");
      }
    ;
    });

    $opal.defs(self, '$call', TMP_1 = function(obj, key, args) {
      var $a, $b, TMP_2, self = this, $iter = TMP_1._p, block = $iter || nil;
      args = $slice.call(arguments, 2);
      TMP_1._p = null;
      
      var prop = obj[key];

      if (prop == null) {
        return nil;
      }
      else if (prop instanceof Function) {
        if (block !== nil) {
          args.push(block);
        }

        args = ($a = ($b = args).$map, $a._p = (TMP_2 = function(value){var self = TMP_2._s || this, $a, native$ = nil;if (value == null) value = nil;
      native$ = self.$try_convert(value);
        if (($a = nil['$==='](native$)) !== false && $a !== nil) {
          return value
          } else {
          return native$
        };}, TMP_2._s = self, TMP_2), $a).call($b);

        return self.$Native(prop.apply(obj, args));
      }
      else if (self['$native?'](prop)) {
        return self.$Native(prop);
      }
      else {
        return prop;
      }
    ;
    });

    (function($base) {
      var self = $module($base, 'Helpers');

      var def = self._proto, $scope = self._scope;
      def.$alias_native = function(new$, old, options) {
        var $a, $b, TMP_3, $c, TMP_4, $d, TMP_5, self = this, as = nil;
        if (old == null) {
          old = new$
        }
        if (options == null) {
          options = $hash2([], {})
        }
        if (($a = old['$end_with?']("=")) !== false && $a !== nil) {
          return ($a = ($b = self).$define_method, $a._p = (TMP_3 = function(value){var self = TMP_3._s || this, $a;
            if (self['native'] == null) self['native'] = nil;
if (value == null) value = nil;
          self['native'][old['$[]']($range(0, -2, false))] = (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$convert(value);
            return value;}, TMP_3._s = self, TMP_3), $a).call($b, new$)
        } else if (($a = as = options['$[]']("as")) !== false && $a !== nil) {
          return ($a = ($c = self).$define_method, $a._p = (TMP_4 = function(args){var self = TMP_4._s || this, block, $a, $b, $c, $d;
            if (self['native'] == null) self['native'] = nil;
args = $slice.call(arguments, 0);
            block = TMP_4._p || nil, TMP_4._p = null;
          if (($a = value = ($b = ($c = (($d = $scope.Native) == null ? $opal.cm('Native') : $d)).$call, $b._p = block.$to_proc(), $b).apply($c, [self['native'], old].concat(args))) !== false && $a !== nil) {
              return as.$new(value.$to_n())
              } else {
              return nil
            }}, TMP_4._s = self, TMP_4), $a).call($c, new$)
          } else {
          return ($a = ($d = self).$define_method, $a._p = (TMP_5 = function(args){var self = TMP_5._s || this, block, $a, $b, $c;
            if (self['native'] == null) self['native'] = nil;
args = $slice.call(arguments, 0);
            block = TMP_5._p || nil, TMP_5._p = null;
          return ($a = ($b = (($c = $scope.Native) == null ? $opal.cm('Native') : $c)).$call, $a._p = block.$to_proc(), $a).apply($b, [self['native'], old].concat(args))}, TMP_5._s = self, TMP_5), $a).call($d, new$)
        };
      }
            ;$opal.donate(self, ["$alias_native"]);
    })(self);

    $opal.defs(self, '$included', function(klass) {
      var $a, self = this;
      return klass.$extend((($a = $scope.Helpers) == null ? $opal.cm('Helpers') : $a));
    });

    def.$initialize = function(native$) {
      var $a, $b, self = this;
      if (($a = (($b = $scope.Kernel) == null ? $opal.cm('Kernel') : $b)['$native?'](native$)) === false || $a === nil) {
        (($a = $scope.Kernel) == null ? $opal.cm('Kernel') : $a).$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "the passed value isn't native")};
      return self['native'] = native$;
    };

    def.$to_n = function() {
      var self = this;
      if (self['native'] == null) self['native'] = nil;

      return self['native'];
    };
        ;$opal.donate(self, ["$initialize", "$to_n"]);
  })(self);
  (function($base) {
    var self = $module($base, 'Kernel');

    var def = self._proto, $scope = self._scope, TMP_6;
    def['$native?'] = function(value) {
      var self = this;
      return value == null || !value._klass;
    };

    def.$Native = function(obj) {
      var $a, $b, self = this;
      if (($a = obj == null) !== false && $a !== nil) {
        return nil
      } else if (($a = self['$native?'](obj)) !== false && $a !== nil) {
        return (($a = ((($b = $scope.Native) == null ? $opal.cm('Native') : $b))._scope).Object == null ? $a.cm('Object') : $a.Object).$new(obj)
        } else {
        return obj
      };
    };

    def.$Array = TMP_6 = function(object, args) {
      var $a, $b, $c, $d, self = this, $iter = TMP_6._p, block = $iter || nil;
      args = $slice.call(arguments, 1);
      TMP_6._p = null;
      
      if (object == null || object === nil) {
        return [];
      }
      else if (self['$native?'](object)) {
        return ($a = ($b = (($c = ((($d = $scope.Native) == null ? $opal.cm('Native') : $d))._scope).Array == null ? $c.cm('Array') : $c.Array)).$new, $a._p = block.$to_proc(), $a).apply($b, [object].concat(args)).$to_a();
      }
      else if (object['$respond_to?']("to_ary")) {
        return object.$to_ary();
      }
      else if (object['$respond_to?']("to_a")) {
        return object.$to_a();
      }
      else {
        return [object];
      }
    ;
    };
        ;$opal.donate(self, ["$native?", "$Native", "$Array"]);
  })(self);
  (function($base, $super) {
    function $Object(){};
    var self = $Object = $klass($base, $super, 'Object', $Object);

    var def = $Object._proto, $scope = $Object._scope, $a, TMP_7, TMP_8, TMP_9, TMP_10;
    def['native'] = nil;
    self.$include((($a = $scope.Native) == null ? $opal.cm('Native') : $a));

    $opal.defn(self, '$==', function(other) {
      var $a, self = this;
      return self['native'] === (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$try_convert(other);
    });

    $opal.defn(self, '$has_key?', function(name) {
      var self = this;
      return self['native'].hasOwnProperty(name);
    });

    $opal.defn(self, '$key?', def['$has_key?']);

    $opal.defn(self, '$include?', def['$has_key?']);

    $opal.defn(self, '$member?', def['$has_key?']);

    $opal.defn(self, '$each', TMP_7 = function(args) {
      var $a, self = this, $iter = TMP_7._p, $yield = $iter || nil;
      args = $slice.call(arguments, 0);
      TMP_7._p = null;
      if (($yield !== nil)) {
        
        for (var key in self['native']) {
          ((($a = $opal.$yieldX($yield, [key, self['native'][key]])) === $breaker) ? $breaker.$v : $a)
        }
      ;
        return self;
        } else {
        return ($a = self).$method_missing.apply($a, ["each"].concat(args))
      };
    });

    $opal.defn(self, '$[]', function(key) {
      var $a, self = this;
      
      var prop = self['native'][key];

      if (prop instanceof Function) {
        return prop;
      }
      else {
        return (($a = $opal.Object._scope.Native) == null ? $opal.cm('Native') : $a).$call(self['native'], key)
      }
    ;
    });

    $opal.defn(self, '$[]=', function(key, value) {
      var $a, self = this, native$ = nil;
      native$ = (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$try_convert(value);
      if (($a = native$ === nil) !== false && $a !== nil) {
        return self['native'][key] = value;
        } else {
        return self['native'][key] = native$;
      };
    });

    $opal.defn(self, '$method_missing', TMP_8 = function(mid, args) {
      var $a, $b, $c, self = this, $iter = TMP_8._p, block = $iter || nil;
      args = $slice.call(arguments, 1);
      TMP_8._p = null;
      
      if (mid.charAt(mid.length - 1) === '=') {
        return self['$[]='](mid.$slice(0, mid.$length()['$-'](1)), args['$[]'](0));
      }
      else {
        return ($a = ($b = (($c = $opal.Object._scope.Native) == null ? $opal.cm('Native') : $c)).$call, $a._p = block.$to_proc(), $a).apply($b, [self['native'], mid].concat(args));
      }
    ;
    });

    $opal.defn(self, '$nil?', function() {
      var self = this;
      return false;
    });

    $opal.defn(self, '$is_a?', function(klass) {
      var $a, self = this;
      return klass['$==']((($a = $scope.Native) == null ? $opal.cm('Native') : $a));
    });

    $opal.defn(self, '$kind_of?', def['$is_a?']);

    $opal.defn(self, '$instance_of?', function(klass) {
      var $a, self = this;
      return klass['$==']((($a = $scope.Native) == null ? $opal.cm('Native') : $a));
    });

    $opal.defn(self, '$class', function() {
      var self = this;
      return self._klass;
    });

    $opal.defn(self, '$to_a', TMP_9 = function(options) {
      var $a, $b, $c, $d, self = this, $iter = TMP_9._p, block = $iter || nil;
      if (options == null) {
        options = $hash2([], {})
      }
      TMP_9._p = null;
      return ($a = ($b = (($c = ((($d = $scope.Native) == null ? $opal.cm('Native') : $d))._scope).Array == null ? $c.cm('Array') : $c.Array)).$new, $a._p = block.$to_proc(), $a).call($b, self['native'], options).$to_a();
    });

    $opal.defn(self, '$to_ary', TMP_10 = function(options) {
      var $a, $b, $c, $d, self = this, $iter = TMP_10._p, block = $iter || nil;
      if (options == null) {
        options = $hash2([], {})
      }
      TMP_10._p = null;
      return ($a = ($b = (($c = ((($d = $scope.Native) == null ? $opal.cm('Native') : $d))._scope).Array == null ? $c.cm('Array') : $c.Array)).$new, $a._p = block.$to_proc(), $a).call($b, self['native'], options);
    });

    return ($opal.defn(self, '$inspect', function() {
      var self = this;
      return "#<Native:" + (String(self['native'])) + ">";
    }), nil);
  })((($a = $scope.Native) == null ? $opal.cm('Native') : $a), (($a = $scope.BasicObject) == null ? $opal.cm('BasicObject') : $a));
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = $Array._proto, $scope = $Array._scope, $a, TMP_11, TMP_12;
    def.named = def['native'] = def.get = def.block = def.set = def.length = nil;
    self.$include((($a = $scope.Native) == null ? $opal.cm('Native') : $a));

    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    def.$initialize = TMP_11 = function(native$, options) {
      var $a, self = this, $iter = TMP_11._p, block = $iter || nil;
      if (options == null) {
        options = $hash2([], {})
      }
      TMP_11._p = null;
      $opal.find_super_dispatcher(self, 'initialize', TMP_11, null).apply(self, [native$]);
      self.get = ((($a = options['$[]']("get")) !== false && $a !== nil) ? $a : options['$[]']("access"));
      self.named = options['$[]']("named");
      self.set = ((($a = options['$[]']("set")) !== false && $a !== nil) ? $a : options['$[]']("access"));
      self.length = ((($a = options['$[]']("length")) !== false && $a !== nil) ? $a : "length");
      self.block = block;
      if (($a = self.$length() == null) !== false && $a !== nil) {
        return self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "no length found on the array-like object")
        } else {
        return nil
      };
    };

    def.$each = TMP_12 = function() {
      var $a, self = this, $iter = TMP_12._p, block = $iter || nil;
      TMP_12._p = null;
      if (($a = block) === false || $a === nil) {
        return self.$enum_for("each")};
      
      for (var i = 0, length = self.$length(); i < length; i++) {
        var value = $opal.$yield1(block, self['$[]'](i));

        if (value === $breaker) {
          return $breaker.$v;
        }
      }
    ;
      return self;
    };

    def['$[]'] = function(index) {
      var $a, self = this, result = nil, $case = nil;
      result = (function() {$case = index;if ((($a = $scope.String) == null ? $opal.cm('String') : $a)['$===']($case) || (($a = $scope.Symbol) == null ? $opal.cm('Symbol') : $a)['$===']($case)) {if (($a = self.named) !== false && $a !== nil) {
        return self['native'][self.named](index);
        } else {
        return self['native'][index];
      }}else if ((($a = $scope.Integer) == null ? $opal.cm('Integer') : $a)['$===']($case)) {if (($a = self.get) !== false && $a !== nil) {
        return self['native'][self.get](index);
        } else {
        return self['native'][index];
      }}else { return nil }})();
      if (result !== false && result !== nil) {
        if (($a = self.block) !== false && $a !== nil) {
          return self.block.$call(result)
          } else {
          return self.$Native(result)
        }
        } else {
        return nil
      };
    };

    def['$[]='] = function(index, value) {
      var $a, self = this;
      if (($a = self.set) !== false && $a !== nil) {
        return self['native'][self.set](index, (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$convert(value));
        } else {
        return self['native'][index] = (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$convert(value);
      };
    };

    def.$last = function(count) {
      var $a, self = this, index = nil, result = nil;
      if (count == null) {
        count = nil
      }
      if (count !== false && count !== nil) {
        index = self.$length()['$-'](1);
        result = [];
        while (index['$>='](0)) {
        result['$<<'](self['$[]'](index));
        index = index['$-'](1);};
        return result;
        } else {
        return self['$[]'](self.$length()['$-'](1))
      };
    };

    def.$length = function() {
      var self = this;
      return self['native'][self.length];
    };

    def.$to_ary = function() {
      var self = this;
      return self;
    };

    return (def.$inspect = function() {
      var self = this;
      return self.$to_a().$inspect();
    }, nil);
  })((($a = $scope.Native) == null ? $opal.cm('Native') : $a), null);
  (function($base, $super) {
    function $Numeric(){};
    var self = $Numeric = $klass($base, $super, 'Numeric', $Numeric);

    var def = $Numeric._proto, $scope = $Numeric._scope;
    return (def.$to_n = function() {
      var self = this;
      return self.valueOf();
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $Proc(){};
    var self = $Proc = $klass($base, $super, 'Proc', $Proc);

    var def = $Proc._proto, $scope = $Proc._scope;
    return (def.$to_n = function() {
      var self = this;
      return self;
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = $String._proto, $scope = $String._scope;
    return (def.$to_n = function() {
      var self = this;
      return self.valueOf();
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $Regexp(){};
    var self = $Regexp = $klass($base, $super, 'Regexp', $Regexp);

    var def = $Regexp._proto, $scope = $Regexp._scope;
    return (def.$to_n = function() {
      var self = this;
      return self.valueOf();
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $MatchData(){};
    var self = $MatchData = $klass($base, $super, 'MatchData', $MatchData);

    var def = $MatchData._proto, $scope = $MatchData._scope;
    def.matches = nil;
    return (def.$to_n = function() {
      var self = this;
      return self.matches;
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $Struct(){};
    var self = $Struct = $klass($base, $super, 'Struct', $Struct);

    var def = $Struct._proto, $scope = $Struct._scope;
    def.$initialize = function(args) {
      var $a, $b, TMP_13, $c, TMP_14, self = this, object = nil;
      args = $slice.call(arguments, 0);
      if (($a = (($b = args.$length()['$=='](1)) ? self['$native?'](args['$[]'](0)) : $b)) !== false && $a !== nil) {
        object = args['$[]'](0);
        return ($a = ($b = self.$members()).$each, $a._p = (TMP_13 = function(name){var self = TMP_13._s || this;if (name == null) name = nil;
        return self.$instance_variable_set("@" + (name), self.$Native(object[name]))}, TMP_13._s = self, TMP_13), $a).call($b);
        } else {
        return ($a = ($c = self.$members()).$each_with_index, $a._p = (TMP_14 = function(name, index){var self = TMP_14._s || this;if (name == null) name = nil;if (index == null) index = nil;
        return self.$instance_variable_set("@" + (name), args['$[]'](index))}, TMP_14._s = self, TMP_14), $a).call($c)
      };
    };

    return (def.$to_n = function() {
      var $a, $b, TMP_15, self = this, result = nil;
      result = {};
      ($a = ($b = self).$each_pair, $a._p = (TMP_15 = function(name, value){var self = TMP_15._s || this;if (name == null) name = nil;if (value == null) value = nil;
      return result[name] = value.$to_n();}, TMP_15._s = self, TMP_15), $a).call($b);
      return result;
    }, nil);
  })(self, null);
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = $Array._proto, $scope = $Array._scope;
    return (def.$to_n = function() {
      var self = this;
      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var obj = self[i];

        if ((obj)['$respond_to?']("to_n")) {
          result.push((obj).$to_n());
        }
        else {
          result.push(obj);
        }
      }

      return result;
    ;
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $Boolean(){};
    var self = $Boolean = $klass($base, $super, 'Boolean', $Boolean);

    var def = $Boolean._proto, $scope = $Boolean._scope;
    return (def.$to_n = function() {
      var self = this;
      return self.valueOf();
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $Time(){};
    var self = $Time = $klass($base, $super, 'Time', $Time);

    var def = $Time._proto, $scope = $Time._scope;
    return (def.$to_n = function() {
      var self = this;
      return self;
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $NilClass(){};
    var self = $NilClass = $klass($base, $super, 'NilClass', $NilClass);

    var def = $NilClass._proto, $scope = $NilClass._scope;
    return (def.$to_n = function() {
      var self = this;
      return null;
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $Hash(){};
    var self = $Hash = $klass($base, $super, 'Hash', $Hash);

    var def = $Hash._proto, $scope = $Hash._scope, TMP_16;
    def.$initialize = TMP_16 = function(defaults) {
      var $a, self = this, $iter = TMP_16._p, block = $iter || nil;
      TMP_16._p = null;
      
      if (defaults != null) {
        if (defaults.constructor === Object) {
          var map  = self.map,
              keys = self.keys;

          for (var key in defaults) {
            var value = defaults[key];

            if (value && value.constructor === Object) {
              map[key] = (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a).$new(value);
            }
            else {
              map[key] = self.$Native(defaults[key]);
            }

            keys.push(key);
          }
        }
        else {
          self.none = defaults;
        }
      }
      else if (block !== nil) {
        self.proc = block;
      }

      return self;
    
    };

    return (def.$to_n = function() {
      var self = this;
      
      var result = {},
          keys   = self.keys,
          map    = self.map,
          bucket,
          value;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i],
            obj = map[key];

        if ((obj)['$respond_to?']("to_n")) {
          result[key] = (obj).$to_n();
        }
        else {
          result[key] = obj;
        }
      }

      return result;
    ;
    }, nil);
  })(self, null);
  (function($base, $super) {
    function $Module(){};
    var self = $Module = $klass($base, $super, 'Module', $Module);

    var def = $Module._proto, $scope = $Module._scope;
    return (def.$native_module = function() {
      var self = this;
      return Opal.global[self.$name()] = self;
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $Class(){};
    var self = $Class = $klass($base, $super, 'Class', $Class);

    var def = $Class._proto, $scope = $Class._scope;
    def.$native_alias = function(jsid, mid) {
      var self = this;
      return self._proto[jsid] = self._proto['$' + mid];
    };

    return $opal.defn(self, '$native_class', def.$native_module);
  })(self, null);
  return $gvars["$"] = $gvars["global"] = self.$Native(Opal.global);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/native.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $gvars = $opal.gvars, $hash2 = $opal.hash2;
  $opal.add_stubs(['$new']);
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  $gvars["&"] = $gvars["~"] = $gvars["`"] = $gvars["'"] = nil;
  $gvars[":"] = [];
  $gvars["\""] = [];
  $gvars["/"] = "\n";
  $gvars[","] = " ";
  $opal.cdecl($scope, 'ARGV', []);
  $opal.cdecl($scope, 'ARGF', (($a = $scope.Object) == null ? $opal.cm('Object') : $a).$new());
  $opal.cdecl($scope, 'ENV', $hash2([], {}));
  $gvars["VERBOSE"] = false;
  $gvars["DEBUG"] = false;
  $gvars["SAFE"] = 0;
  $opal.cdecl($scope, 'RUBY_PLATFORM', "opal");
  $opal.cdecl($scope, 'RUBY_ENGINE', "opal");
  $opal.cdecl($scope, 'RUBY_VERSION', "1.9.3");
  $opal.cdecl($scope, 'RUBY_ENGINE_VERSION', "0.5.5");
  return $opal.cdecl($scope, 'RUBY_RELEASE_DATE', "2013-11-25");
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/opal.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$include', '$attr_reader', '$expose', '$alias_native', '$[]=', '$nil?', '$is_a?', '$to_n', '$has_key?', '$delete', '$call', '$gsub', '$upcase', '$[]', '$compact', '$map', '$respond_to?', '$<<', '$from_native', '$new']);
  
  var root = $opal.global, dom_class;

  if (root.jQuery) {
    dom_class = jQuery
  }
  else if (root.Zepto) {
    dom_class = Zepto.zepto.Z;
  }
  else {
    throw new Error("jQuery must be included before opal-jquery");
  }

  return (function($base, $super) {
    function $Element(){};
    var self = $Element = $klass($base, $super, 'Element', $Element);

    var def = $Element._proto, $scope = $Element._scope, $a, TMP_1, TMP_2, TMP_5, TMP_6;
    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    $opal.defs(self, '$find', function(selector) {
      var self = this;
      return $(selector);
    });

    $opal.defs(self, '$[]', function(selector) {
      var self = this;
      return $(selector);
    });

    $opal.defs(self, '$id', function(id) {
      var self = this;
      
      var el = document.getElementById(id);

      if (!el) {
        return nil;
      }

      return $(el);
    
    });

    $opal.defs(self, '$new', function(tag) {
      var self = this;
      if (tag == null) {
        tag = "div"
      }
      return $(document.createElement(tag));
    });

    $opal.defs(self, '$parse', function(str) {
      var self = this;
      return $(str);
    });

    $opal.defs(self, '$expose', function(methods) {
      var self = this;
      methods = $slice.call(arguments, 0);
      
      for (var i = 0, length = methods.length, method; i < length; i++) {
        method = methods[i];
        self._proto['$' + method] = self._proto[method];
      }

      return nil;
    
    });

    self.$attr_reader("selector");

    self.$expose("after", "before", "parent", "parents", "prepend", "prev", "remove");

    self.$expose("hide", "show", "toggle", "children", "blur", "closest", "data");

    self.$expose("focus", "find", "next", "siblings", "text", "trigger", "append");

    self.$expose("height", "width", "serialize", "is", "filter", "last", "first");

    self.$expose("wrap", "stop", "clone", "empty");

    self.$expose("get", "attr", "prop");

    $opal.defn(self, '$succ', def.$next);

    $opal.defn(self, '$<<', def.$append);

    self.$alias_native("[]=", "attr");

    self.$alias_native("add_class", "addClass");

    self.$alias_native("append_to", "appendTo");

    self.$alias_native("has_class?", "hasClass");

    self.$alias_native("html=", "html");

    self.$alias_native("remove_attr", "removeAttr");

    self.$alias_native("remove_class", "removeClass");

    self.$alias_native("text=", "text");

    self.$alias_native("toggle_class", "toggleClass");

    self.$alias_native("value=", "val");

    self.$alias_native("scroll_left=", "scrollLeft");

    self.$alias_native("scroll_left", "scrollLeft");

    self.$alias_native("remove_attribute", "removeAttr");

    self.$alias_native("slide_down", "slideDown");

    self.$alias_native("slide_up", "slideUp");

    self.$alias_native("slide_toggle", "slideToggle");

    self.$alias_native("fade_toggle", "fadeToggle");

    def.$to_n = function() {
      var self = this;
      return self;
    };

    def['$[]'] = function(name) {
      var self = this;
      return self.attr(name) || "";
    };

    def.$add_attribute = function(name) {
      var self = this;
      return self['$[]='](name, "");
    };

    def['$has_attribute?'] = function(name) {
      var self = this;
      return !!self.attr(name);
    };

    def.$append_to_body = function() {
      var self = this;
      return self.appendTo(document.body);
    };

    def.$append_to_head = function() {
      var self = this;
      return self.appendTo(document.head);
    };

    def.$at = function(index) {
      var self = this;
      
      var length = self.length;

      if (index < 0) {
        index += length;
      }

      if (index < 0 || index >= length) {
        return nil;
      }

      return $(self[index]);
    
    };

    def.$class_name = function() {
      var self = this;
      
      var first = self[0];
      return (first && first.className) || "";
    
    };

    def['$class_name='] = function(name) {
      var self = this;
      
      for (var i = 0, length = self.length; i < length; i++) {
        self[i].className = name;
      }
    
      return self;
    };

    def.$css = function(name, value) {
      var $a, $b, $c, self = this;
      if (value == null) {
        value = nil
      }
      if (($a = ($b = value['$nil?'](), $b !== false && $b !== nil ?name['$is_a?']((($c = $scope.String) == null ? $opal.cm('String') : $c)) : $b)) !== false && $a !== nil) {
        return self.css(name)
      } else if (($a = name['$is_a?']((($b = $scope.Hash) == null ? $opal.cm('Hash') : $b))) !== false && $a !== nil) {
        self.css(name.$to_n());
        } else {
        self.css(name, value);
      };
      return self;
    };

    def.$animate = TMP_1 = function(params) {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil, speed = nil;
      TMP_1._p = null;
      speed = (function() {if (($a = params['$has_key?']("speed")) !== false && $a !== nil) {
        return params.$delete("speed")
        } else {
        return 400
      }; return nil; })();
      
      self.animate(params.$to_n(), speed, function() {
        (function() {if ((block !== nil)) {
        return block.$call()
        } else {
        return nil
      }; return nil; })()
      })
    ;
    };

    def.$effect = TMP_2 = function(name, args) {
      var $a, $b, TMP_3, $c, TMP_4, self = this, $iter = TMP_2._p, block = $iter || nil;
      args = $slice.call(arguments, 1);
      TMP_2._p = null;
      name = ($a = ($b = name).$gsub, $a._p = (TMP_3 = function(match){var self = TMP_3._s || this;if (match == null) match = nil;
      return match['$[]'](1).$upcase()}, TMP_3._s = self, TMP_3), $a).call($b, /_\w/);
      args = ($a = ($c = args).$map, $a._p = (TMP_4 = function(a){var self = TMP_4._s || this, $a;if (a == null) a = nil;
      if (($a = a['$respond_to?']("to_n")) !== false && $a !== nil) {
          return a.$to_n()
          } else {
          return nil
        }}, TMP_4._s = self, TMP_4), $a).call($c).$compact();
      args['$<<'](function() { (function() {if ((block !== nil)) {
        return block.$call()
        } else {
        return nil
      }; return nil; })() });
      return self[name].apply(self, args);
    };

    def['$visible?'] = function() {
      var self = this;
      return self.is(':visible');
    };

    def.$offset = function() {
      var $a, self = this;
      return (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a).$from_native(self.offset());
    };

    def.$each = TMP_5 = function() {
      var self = this, $iter = TMP_5._p, $yield = $iter || nil;
      TMP_5._p = null;
      for (var i = 0, length = self.length; i < length; i++) {
      if ($opal.$yield1($yield, $(self[i])) === $breaker) return $breaker.$v;
      };
      return self;
    };

    def.$first = function() {
      var self = this;
      return self.length ? self.first() : nil;
    };

    def.$html = function(content) {
      var self = this;
      
      if (content != null) {
        return self.html(content);
      }

      return self.html() || '';
    
    };

    def.$id = function() {
      var self = this;
      
      var first = self[0];
      return (first && first.id) || "";
    
    };

    def['$id='] = function(id) {
      var self = this;
      
      var first = self[0];

      if (first) {
        first.id = id;
      }

      return self;
    
    };

    def.$tag_name = function() {
      var self = this;
      return self.length > 0 ? self[0].tagName.toLowerCase() : nil;
    };

    def.$inspect = function() {
      var self = this;
      
      var val, el, str, result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        el  = self[i];
        str = "<" + el.tagName.toLowerCase();

        if (val = el.id) str += (' id="' + val + '"');
        if (val = el.className) str += (' class="' + val + '"');

        result.push(str + '>');
      }

      return '#<Element [' + result.join(', ') + ']>';
    
    };

    def.$length = function() {
      var self = this;
      return self.length;
    };

    def['$any?'] = function() {
      var self = this;
      return self.length > 0;
    };

    def['$empty?'] = function() {
      var self = this;
      return self.length === 0;
    };

    $opal.defn(self, '$empty?', def['$none?']);

    def.$on = TMP_6 = function(name, sel) {
      var $a, self = this, $iter = TMP_6._p, block = $iter || nil;
      if (sel == null) {
        sel = nil
      }
      TMP_6._p = null;
      
      var wrapper = function(evt) {
        if (evt.preventDefault) {
          evt = (($a = $scope.Event) == null ? $opal.cm('Event') : $a).$new(evt);
        }

        return block.apply(null, arguments);
      };

      block._jq_wrap = wrapper;

      if (sel == nil) {
        self.on(name, wrapper);
      }
      else {
        self.on(name, sel, wrapper);
      }
    ;
      return block;
    };

    def.$off = function(name, sel, block) {
      var self = this;
      if (block == null) {
        block = nil
      }
      
      if (sel == null) {
        return self.off(name);
      }
      else if (block === nil) {
        return self.off(name, sel._jq_wrap);
      }
      else {
        return self.off(name, sel, block._jq_wrap);
      }
    
    };

    $opal.defn(self, '$size', def.$length);

    return (def.$value = function() {
      var self = this;
      return self.val() || "";
    }, nil);
  })(self, dom_class);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/opal-jquery/element.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $gvars = $opal.gvars;
  $opal.add_stubs(['$find']);
  ;
  $opal.cdecl($scope, 'Window', (($a = $scope.Element) == null ? $opal.cm('Element') : $a).$find(window));
  return $gvars["window"] = (($a = $scope.Window) == null ? $opal.cm('Window') : $a);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/opal-jquery/window.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $gvars = $opal.gvars;
  $opal.add_stubs(['$find']);
  ;
  $opal.cdecl($scope, 'Document', (($a = $scope.Element) == null ? $opal.cm('Element') : $a).$find(document));
  (function(self) {
    var $scope = self._scope, def = self._proto;
    self._proto['$ready?'] = TMP_1 = function() {
      var self = this, $iter = TMP_1._p, block = $iter || nil;
      TMP_1._p = null;
      if (block !== false && block !== nil) {
        return $(block);
        } else {
        return nil
      };
    };
    self._proto.$title = function() {
      var self = this;
      return document.title;
    };
    return (self._proto['$title='] = function(title) {
      var self = this;
      return document.title = title;
    }, nil);
  })((($a = $scope.Document) == null ? $opal.cm('Document') : $a).$singleton_class());
  return $gvars["document"] = (($a = $scope.Document) == null ? $opal.cm('Document') : $a);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/opal-jquery/document.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;
  $opal.add_stubs(['$stop_propagation', '$prevent_default']);
  return (function($base, $super) {
    function $Event(){};
    var self = $Event = $klass($base, $super, 'Event', $Event);

    var def = $Event._proto, $scope = $Event._scope;
    def['native'] = nil;
    def.$initialize = function(native$) {
      var self = this;
      return self['native'] = native$;
    };

    def['$[]'] = function(name) {
      var self = this;
      return self['native'][name];
    };

    def.$type = function() {
      var self = this;
      return self['native'].type;
    };

    def.$current_target = function() {
      var self = this;
      return $(self['native'].currentTarget);
    };

    def.$target = function() {
      var self = this;
      return $(self['native'].target);
    };

    def['$default_prevented?'] = function() {
      var self = this;
      return self['native'].isDefaultPrevented();
    };

    def.$prevent_default = function() {
      var self = this;
      return self['native'].preventDefault();
    };

    def['$propagation_stopped?'] = function() {
      var self = this;
      return self['native'].propagationStopped();
    };

    def.$stop_propagation = function() {
      var self = this;
      return self['native'].stopPropagation();
    };

    def.$stop_immediate_propagation = function() {
      var self = this;
      return self['native'].stopImmediatePropagation();
    };

    def.$kill = function() {
      var self = this;
      self.$stop_propagation();
      return self.$prevent_default();
    };

    def.$page_x = function() {
      var self = this;
      return self['native'].pageX;
    };

    def.$page_y = function() {
      var self = this;
      return self['native'].pageY;
    };

    def.$touch_x = function() {
      var self = this;
      return self['native'].originalEvent.touches[0].pageX;
    };

    def.$touch_y = function() {
      var self = this;
      return self['native'].originalEvent.touches[0].pageY;
    };

    def.$ctrl_key = function() {
      var self = this;
      return self['native'].ctrlKey;
    };

    def.$key_code = function() {
      var self = this;
      return self['native'].keyCode;
    };

    return (def.$which = function() {
      var self = this;
      return self['native'].which;
    }, nil);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/opal-jquery/event.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module, $hash2 = $opal.hash2, $klass = $opal.klass;
  $opal.add_stubs(['$new', '$push', '$[]=', '$[]', '$create_id', '$json_create', '$attr_accessor', '$create_id=', '$===', '$parse', '$generate', '$from_object', '$to_json', '$responds_to?', '$to_io', '$write', '$to_s', '$strftime']);
  (function($base) {
    var self = $module($base, 'JSON');

    var def = self._proto, $scope = self._scope, $a;
    
    var $parse  = JSON.parse,
        $hasOwn = Opal.hasOwnProperty;

    function to_opal(value, options) {
      switch (typeof value) {
        case 'string':
          return value;

        case 'number':
          return value;

        case 'boolean':
          return !!value;

        case 'null':
          return nil;

        case 'object':
          if (!value) return nil;

          if (value._isArray) {
            var arr = (options.array_class).$new();

            for (var i = 0, ii = value.length; i < ii; i++) {
              (arr).$push(to_opal(value[i], options));
            }

            return arr;
          }
          else {
            var hash = (options.object_class).$new();

            for (var k in value) {
              if ($hasOwn.call(value, k)) {
                (hash)['$[]='](k, to_opal(value[k], options));
              }
            }

            var klass;
            if ((klass = (hash)['$[]']((($a = $scope.JSON) == null ? $opal.cm('JSON') : $a).$create_id())) != nil) {
              klass = Opal.cget(klass);
              return (klass).$json_create(hash);
            }
            else {
              return hash;
            }
          }
      }
    };
  

    (function(self) {
      var $scope = self._scope, def = self._proto;
      return self.$attr_accessor("create_id")
    })(self.$singleton_class());

    self['$create_id=']("json_class");

    $opal.defs(self, '$[]', function(value, options) {
      var $a, $b, self = this;
      if (options == null) {
        options = $hash2([], {})
      }
      if (($a = (($b = $scope.String) == null ? $opal.cm('String') : $b)['$==='](value)) !== false && $a !== nil) {
        return self.$parse(value, options)
        } else {
        return self.$generate(value, options)
      };
    });

    $opal.defs(self, '$parse', function(source, options) {
      var self = this;
      if (options == null) {
        options = $hash2([], {})
      }
      return self.$from_object($parse(source), options);
    });

    $opal.defs(self, '$parse!', function(source, options) {
      var self = this;
      if (options == null) {
        options = $hash2([], {})
      }
      return self.$parse(source, options);
    });

    $opal.defs(self, '$from_object', function(js_object, options) {
      var $a, $b, $c, $d, self = this;
      if (options == null) {
        options = $hash2([], {})
      }
      ($a = "object_class", $b = options, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, (($d = $scope.Hash) == null ? $opal.cm('Hash') : $d))));
      ($a = "array_class", $b = options, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, (($d = $scope.Array) == null ? $opal.cm('Array') : $d))));
      return to_opal(js_object, options.map);
    });

    $opal.defs(self, '$generate', function(obj, options) {
      var self = this;
      if (options == null) {
        options = $hash2([], {})
      }
      return obj.$to_json(options);
    });

    $opal.defs(self, '$dump', function(obj, io, limit) {
      var $a, self = this, string = nil;
      if (io == null) {
        io = nil
      }
      if (limit == null) {
        limit = nil
      }
      string = self.$generate(obj);
      if (io !== false && io !== nil) {
        if (($a = io['$responds_to?']("to_io")) !== false && $a !== nil) {
          io = io.$to_io()};
        io.$write(string);
        return io;
        } else {
        return string
      };
    });
    
  })(self);
  (function($base, $super) {
    function $Object(){};
    var self = $Object = $klass($base, $super, 'Object', $Object);

    var def = $Object._proto, $scope = $Object._scope;
    $opal.defn(self, '$to_json', function() {
      var self = this;
      return self.$to_s().$to_json();
    });

    return ($opal.defn(self, '$as_json', function() {
      var self = this;
      return nil;
    }), nil);
  })(self, null);
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = $Array._proto, $scope = $Array._scope;
    return (def.$to_json = function() {
      var self = this;
      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        result.push((self[i]).$to_json());
      }

      return '[' + result.join(', ') + ']';
    
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $Boolean(){};
    var self = $Boolean = $klass($base, $super, 'Boolean', $Boolean);

    var def = $Boolean._proto, $scope = $Boolean._scope;
    def.$as_json = function() {
      var self = this;
      return self;
    };

    return (def.$to_json = function() {
      var self = this;
      return (self == true) ? 'true' : 'false';
    }, nil);
  })(self, null);
  (function($base, $super) {
    function $Hash(){};
    var self = $Hash = $klass($base, $super, 'Hash', $Hash);

    var def = $Hash._proto, $scope = $Hash._scope;
    return (def.$to_json = function() {
      var self = this;
      
      var inspect = [], keys = self.keys, map = self.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];
        inspect.push((key).$to_s().$to_json() + ':' + (map[key]).$to_json());
      }

      return '{' + inspect.join(', ') + '}';
    ;
    }, nil)
  })(self, null);
  (function($base, $super) {
    function $NilClass(){};
    var self = $NilClass = $klass($base, $super, 'NilClass', $NilClass);

    var def = $NilClass._proto, $scope = $NilClass._scope;
    def.$as_json = function() {
      var self = this;
      return self;
    };

    return (def.$to_json = function() {
      var self = this;
      return "null";
    }, nil);
  })(self, null);
  (function($base, $super) {
    function $Numeric(){};
    var self = $Numeric = $klass($base, $super, 'Numeric', $Numeric);

    var def = $Numeric._proto, $scope = $Numeric._scope;
    def.$as_json = function() {
      var self = this;
      return self;
    };

    return (def.$to_json = function() {
      var self = this;
      return self.toString();
    }, nil);
  })(self, null);
  (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = $String._proto, $scope = $String._scope;
    def.$as_json = function() {
      var self = this;
      return self;
    };

    return $opal.defn(self, '$to_json', def.$inspect);
  })(self, null);
  return (function($base, $super) {
    function $Time(){};
    var self = $Time = $klass($base, $super, 'Time', $Time);

    var def = $Time._proto, $scope = $Time._scope;
    return (def.$to_json = function() {
      var self = this;
      return self.$strftime("%FT%T%z").$to_json();
    }, nil)
  })(self, null);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/json.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $hash2 = $opal.hash2;
  $opal.add_stubs(['$attr_reader', '$send!', '$new', '$delete', '$to_n', '$from_object', '$succeed', '$fail', '$p', '$call', '$parse', '$xhr']);
  ;
  ;
  return (function($base, $super) {
    function $HTTP(){};
    var self = $HTTP = $klass($base, $super, 'HTTP', $HTTP);

    var def = $HTTP._proto, $scope = $HTTP._scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6;
    def.callback = def.errback = def.json = def.body = def.ok = def.settings = nil;
    self.$attr_reader("body", "error_message", "method", "status_code", "url", "xhr");

    $opal.defs(self, '$get', TMP_1 = function(url, opts) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;
      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_1._p = null;
      return self.$new(url, "GET", opts, block)['$send!']();
    });

    $opal.defs(self, '$post', TMP_2 = function(url, opts) {
      var self = this, $iter = TMP_2._p, block = $iter || nil;
      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_2._p = null;
      return self.$new(url, "POST", opts, block)['$send!']();
    });

    $opal.defs(self, '$put', TMP_3 = function(url, opts) {
      var self = this, $iter = TMP_3._p, block = $iter || nil;
      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_3._p = null;
      return self.$new(url, "PUT", opts, block)['$send!']();
    });

    $opal.defs(self, '$delete', TMP_4 = function(url, opts) {
      var self = this, $iter = TMP_4._p, block = $iter || nil;
      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_4._p = null;
      return self.$new(url, "DELETE", opts, block)['$send!']();
    });

    def.$initialize = function(url, method, options, handler) {
      var $a, self = this, http = nil, payload = nil, settings = nil;
      if (handler == null) {
        handler = nil
      }
      self.url = url;
      self.method = method;
      self.ok = true;
      self.xhr = nil;
      http = self;
      payload = options.$delete("payload");
      settings = options.$to_n();
      if (handler !== false && handler !== nil) {
        self.callback = self.errback = handler};
      
      if (typeof(payload) === 'string') {
        settings.data = payload;
      }
      else if (payload != nil) {
        settings.data = payload.$to_json();
        settings.contentType = 'application/json';
      }

      settings.url  = url;
      settings.type = method;

      settings.success = function(data, status, xhr) {
        http.body = data;
        http.xhr = xhr;

        if (typeof(data) === 'object') {
          http.json = (($a = $scope.JSON) == null ? $opal.cm('JSON') : $a).$from_object(data);
        }

        return http.$succeed();
      };

      settings.error = function(xhr, status, error) {
        http.body = xhr.responseText;
        http.xhr = xhr;

        return http.$fail();
      };
    
      return self.settings = settings;
    };

    def.$callback = TMP_5 = function() {
      var self = this, $iter = TMP_5._p, block = $iter || nil;
      TMP_5._p = null;
      self.callback = block;
      self.$p(self.callback);
      return self;
    };

    def.$errback = TMP_6 = function() {
      var self = this, $iter = TMP_6._p, block = $iter || nil;
      TMP_6._p = null;
      self.errback = block;
      return self;
    };

    def.$fail = function() {
      var $a, self = this;
      self.ok = false;
      if (($a = self.errback) !== false && $a !== nil) {
        return self.errback.$call(self)
        } else {
        return nil
      };
    };

    def.$json = function() {
      var $a, $b, self = this;
      return ((($a = self.json) !== false && $a !== nil) ? $a : (($b = $scope.JSON) == null ? $opal.cm('JSON') : $b).$parse(self.body));
    };

    def['$ok?'] = function() {
      var self = this;
      return self.ok;
    };

    def['$send!'] = function() {
      var self = this;
      $.ajax(self.settings);
      return self;
    };

    def.$succeed = function() {
      var $a, self = this;
      if (($a = self.callback) !== false && $a !== nil) {
        return self.callback.$call(self)
        } else {
        return nil
      };
    };

    return (def.$get_header = function(key) {
      var self = this;
      return self.$xhr().getResponseHeader(key);;
    }, nil);
  })(self, null);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/opal-jquery/http.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module;
  $opal.add_stubs([]);
  return (function($base) {
    var self = $module($base, 'Kernel');

    var def = self._proto, $scope = self._scope;
    def.$alert = function(msg) {
      var self = this;
      alert(msg);
      return nil;
    }
        ;$opal.donate(self, ["$alert"]);
  })(self)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/opal-jquery/kernel.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice;
  $opal.add_stubs([]);
  ;
  ;
  ;
  ;
  ;
  return true;
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/opal-jquery.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $hash2 = $opal.hash2, $hash = $opal.hash, $range = $opal.range;
  $opal.add_stubs(['$collect', '$gsub', '$[]', '$to_proc', '$to_a', '$is_a?', '$each', '$parse_line', '$include?', '$split', '$parse_instruction', '$scan', '$join', '$upcase', '$match', '$new', '$to_s', '$start_with?', '$sprintf', '$map', '$to_i', '$keys', '$<', '$size', '$+', '$*', '$-', '$<<', '$parse_instruction_simple', '$assemble', '$collect!', '$=~', '$strip', '$>', '$==', '$[]=', '$first', '$compact', '$nil?', '$last']);
  return (function($base, $super) {
    function $Assembler(){};
    var self = $Assembler = $klass($base, $super, 'Assembler', $Assembler);

    var def = $Assembler._proto, $scope = $Assembler._scope;
    def.instructions = def.reverse_instructions = def.text = def.current_address = def.binary = def.result = def.labels = def.address = nil;
    def.$initialize = function() {
      var $a, $b, TMP_1, $c, $d, self = this;
      self.labels = $hash2([], {});
      self.address = 512;
      self.result = [];
      self.binary = [];
      self.text = [];
      self.instructions = $hash(/CLS/, "00E0", /RET/, "00EE", /JP (\w+)/, "1%03x", /CALL (\w+)/, "2%03x", /SE V(\d+), (\d+)/, "3%1x%02x", /SNE V(\d+), (\d+)/, "4%1x%02x", /SE V(\d+), V(\d+)/, "5%1x%1x0", /LD V(\d+), (\d+)/, "6%1x%02x", /ADD V(\d+), (\d+)/, "7%1x%02x", /LD V(\d+), V(\d+)/, "8%1x%1x0", /OR V(\d+), V(\d+)/, "8%1x%1x1", /AND V(\d+), V(\d+)/, "8%1x%1x2", /XOR V(\d+), V(\d+)/, "8%1x%1x3", /ADD V(\d+), V(\d+)/, "8%1x%1x4", /SUB V(\d+), V(\d+)/, "8%1x%1x5", /SHR V(\d+)/, "8%1x06", /SUBN V(\d+), V(\d+)/, "8%1x%1x7", /SHL V(\d+)/, "8%1x0E", /SNE V(\d+), V(\d+)/, "9%1x%1x0", /LD I, (\w+)/, "A%03x", /JP V0, (\w+)/, "B%03x", /RND V(\d+), (\d+)/, "C%1x%02x", /DRW V(\d+), V(\d+), (\d+)/, "D%1x%1x%1x", /SKP V(\d+)/, "E%1x9E", /SKNP V(\d+)/, "E%1xA1", /LD V(\d+), DT/, "F%1x07", /LD V(\d+), K/, "F%1x0A", /LD DT, V(\d+)/, "F%1x15", /LD ST, V(\d+)/, "F%1x18", /ADD I, V(\d+)/, "F%1x1E", /LD F, V(\d+)/, "F%1x29", /LD B, V(\d+)/, "F%1x33", /LD -I-, V(\d+)/, "F%1x55", /LD V(\d+), -I-/, "F%1x65");
      self.reverse_instructions = ($a = ($b = (($c = $scope.Hash) == null ? $opal.cm('Hash') : $c)['$[]'](($c = ($d = self.instructions.$to_a()).$collect, $c._p = "reverse".$to_proc(), $c).call($d))).$collect, $a._p = (TMP_1 = function(k, v){var self = TMP_1._s || this;if (k == null) k = nil;if (v == null) v = nil;
      return [k.$gsub("%1x", "(.)").$gsub("%02x", "(..)").$gsub("%03x", "(...)"), v]}, TMP_1._s = self, TMP_1), $a).call($b);
      return self.reverse_instructions = (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a)['$[]'](self.reverse_instructions);
    };

    def.$parse = function(data) {
      var $a, $b, TMP_2, $c, TMP_3, self = this;
      if (($a = data['$is_a?']((($b = $scope.Array) == null ? $opal.cm('Array') : $b))) !== false && $a !== nil) {
        ($a = ($b = data).$each, $a._p = (TMP_2 = function(line){var self = TMP_2._s || this;if (line == null) line = nil;
        return self.$parse_line(line)}, TMP_2._s = self, TMP_2), $a).call($b)
        } else {
        data = data.$gsub("\\n", "\n");
        if (($a = data['$include?']("\n")) !== false && $a !== nil) {
          ($a = ($c = data.$split("\n")).$each, $a._p = (TMP_3 = function(line){var self = TMP_3._s || this;if (line == null) line = nil;
          return self.$parse_line(line)}, TMP_3._s = self, TMP_3), $a).call($c)};
      };
      return self;
    };

    def.$unparse = function(data) {
      var $a, $b, TMP_4, $c, TMP_5, self = this;
      self.current_address = 512;
      if (($a = data['$is_a?']((($b = $scope.Array) == null ? $opal.cm('Array') : $b))) !== false && $a !== nil) {
        ($a = ($b = data).$each, $a._p = (TMP_4 = function(i){var self = TMP_4._s || this;if (i == null) i = nil;
        return self.$parse_instruction(i)}, TMP_4._s = self, TMP_4), $a).call($b)
        } else {
        data = data.$gsub("\\n", "").$gsub("\\r", "");
        ($a = ($c = data).$scan, $a._p = (TMP_5 = function(i){var self = TMP_5._s || this;if (i == null) i = nil;
        return self.$parse_instruction(i)}, TMP_5._s = self, TMP_5), $a).call($c, /..../);
      };
      return self.text.$join("\n");
    };

    def.$parse_instruction_simple = function(i) {try {

      var $a, $b, TMP_6, self = this;
      i = i.$upcase();
      ($a = ($b = self.reverse_instructions.$keys()).$each, $a._p = (TMP_6 = function(re){var self = TMP_6._s || this, $a, $b, $c, $d, TMP_7, m = nil, ins = nil;
        if (self.reverse_instructions == null) self.reverse_instructions = nil;
if (re == null) re = nil;
      if (($a = ($b = ($c = (m = i.$match((($d = $scope.Regexp) == null ? $opal.cm('Regexp') : $d).$new(re))), ($c === nil || $c === false)), ($b === nil || $b === false))) !== false && $a !== nil) {
          ins = self.reverse_instructions['$[]'](re).$to_s();
          if (($a = ins['$start_with?']("(")) !== false && $a !== nil) {
            ins = ins['$[]']($range(7, -2, false))};
          $opal.$return(($a = self).$sprintf.apply($a, [ins.$to_s().$gsub("(\\d+)", "%d").$gsub("(\\w+)", "%d")].concat((($b = ($c = m.$to_a()['$[]']($range(1, -1, false))).$map, $b._p = (TMP_7 = function(x){var self = TMP_7._s || this;if (x == null) x = nil;
          return x.$to_i(16)}, TMP_7._s = self, TMP_7), $b).call($c)))));
          } else {
          return nil
        }}, TMP_6._s = self, TMP_6), $a).call($b);
      return self.$sprintf(".data %d", i.$to_i(16));
      } catch ($returner) { if ($returner === $opal.returner) { return $returner.$v } throw $returner; }
    };

    def.$parse_instruction = function(i) {
      var self = this, s = nil;
      s = self.current_address.$to_s();
      if (s.$size()['$<'](4)) {
        s = (" "['$*'](((4)['$-'](s.$size()))))['$+'](s)};
      self.text['$<<'](s['$+'](": ")['$+'](self.$parse_instruction_simple(i)));
      return self.current_address = self.current_address['$+'](2);
    };

    def.$output = function(where) {
      var self = this;
      if (where == null) {
        where = nil
      }
      self.$assemble();
      return self.binary;
    };

    def.$assemble = function() {
      var $a, $b, TMP_8, self = this;
      return ($a = ($b = self.result).$each, $a._p = (TMP_8 = function(instruction, parameters){var self = TMP_8._s || this, $a, $b, TMP_9, str = nil;
        if (self.binary == null) self.binary = nil;
if (instruction == null) instruction = nil;if (parameters == null) parameters = nil;
      ($a = ($b = parameters)['$collect!'], $a._p = (TMP_9 = function(p){var self = TMP_9._s || this, $a, $b, $c;
          if (self.labels == null) self.labels = nil;
if (p == null) p = nil;
        if (($a = ($b = ($c = (p['$=~'](/^[-+]?[0-9]+$/)), ($c === nil || $c === false)), ($b === nil || $b === false))) !== false && $a !== nil) {
            return p.$to_i()
            } else {
            return self.labels['$[]'](p)
          }}, TMP_9._s = self, TMP_9), $a).call($b);
        str = ($a = self).$sprintf.apply($a, [instruction].concat(parameters));
        return self.binary['$<<'](str['$[]']($range(0, 1, false)).$to_i(16))['$<<'](str['$[]']($range(2, 3, false)).$to_i(16));}, TMP_8._s = self, TMP_8), $a).call($b);
    };

    return (def.$parse_line = function(line) {
      var $a, $b, TMP_10, $c, TMP_11, $d, self = this, r = nil;
      if (($a = line['$is_a?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== false && $a !== nil) {
        line = line.$strip().$split(" ")};
      if (line.$size()['$>'](0)) {
        if (line['$[]'](0)['$[]'](0)['$=='](";")) {
          return nil};
        if (line['$[]'](0)['$[]']($range(-1, -1, false))['$=='](":")) {
          self.labels['$[]='](line['$[]'](0).$split(":")['$[]'](0).$upcase(), self.address);
          if (line['$[]']($range(1, -1, false)).$size()['$>'](0)) {
            self.$parse_line(line['$[]']($range(1, -1, false)))};
          return nil;};
        line = ($a = ($b = line)['$collect!'], $a._p = (TMP_10 = function(i){var self = TMP_10._s || this;if (i == null) i = nil;
        return i.$upcase()}, TMP_10._s = self, TMP_10), $a).call($b).$join(" ");
        r = ($a = ($c = self.instructions.$keys()).$map, $a._p = (TMP_11 = function(re){var self = TMP_11._s || this, $a, $b;if (re == null) re = nil;
        if (($a = (($b = line.$match(re), $b !== false && $b !== nil ?re.$to_s().$split().$size()['$=='](line.$split().$size()) : $b))) !== false && $a !== nil) {
            return re
            } else {
            return nil
          }}, TMP_11._s = self, TMP_11), $a).call($c).$compact().$first();
        if (($a = ((($d = r['$nil?']()) !== false && $d !== nil) ? $d : self.instructions['$[]'](r)['$nil?']())) !== false && $a !== nil) {
          self.result['$<<'](["%04x", [line.$split(" ").$last().$to_i().$to_s()]])
          } else {
          self.result['$<<']([self.instructions['$[]'](r), line.$match(r).$to_a()['$[]']($range(1, -1, false))])
        };
        return self.address = self.address['$+'](2);
        } else {
        return nil
      };
    }, nil);
  })(self, null)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/assembler.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module, $klass = $opal.klass;
  $opal.add_stubs(['$attr_accessor', '$[]', '$to_i', '$-', '$new', '$delete_if', '$nil?', '$>']);
  return (function($base) {
    var self = $module($base, 'Rubygame');

    var def = self._proto, $scope = self._scope;
    (function($base, $super) {
      function $KeyDownEvent(){};
      var self = $KeyDownEvent = $klass($base, $super, 'KeyDownEvent', $KeyDownEvent);

      var def = $KeyDownEvent._proto, $scope = $KeyDownEvent._scope;
      self.$attr_accessor("key");

      return (def.$initialize = function(key) {
        var self = this;
        return self.key = key;
      }, nil);
    })(self, null);

    (function($base, $super) {
      function $Screen(){};
      var self = $Screen = $klass($base, $super, 'Screen', $Screen);

      var def = $Screen._proto, $scope = $Screen._scope;
      def.$initialize = function(size) {
        var self = this;
        self.ctx = document.getElementById('screen').getContext('2d');
        
            this.ctx.fillStyle='#000000';
            this.ctx.fillRect(0,0,size['$[]'](0),size['$[]'](1));
            ;
      };

      def.$draw_box_s = function(p1, p2, c) {
        var self = this, color = nil;
        color = "rgb(" + (c['$[]'](0)) + ", " + (c['$[]'](1)) + ", " + (c['$[]'](2)) + ")";
        
            this.ctx.fillStyle=color;
            this.ctx.fillRect(p1['$[]'](0).$to_i(),p1['$[]'](1).$to_i(),p2['$[]'](0).$to_i()['$-'](p1['$[]'](0).$to_i()),p2['$[]'](1).$to_i()['$-'](p1['$[]'](1).$to_i()));
            ;
        return self;
      };

      return (def.$update = function() {
        var self = this;
        return nil;
      }, nil);
    })(self, null);

    (function($base, $super) {
      function $EventQueue(){};
      var self = $EventQueue = $klass($base, $super, 'EventQueue', $EventQueue);

      var def = $EventQueue._proto, $scope = $EventQueue._scope, TMP_2;
      return (def.$each = TMP_2 = function() {
        var $a, $b, TMP_1, self = this, $iter = TMP_2._p, $yield = $iter || nil, array = nil, k = nil, now = nil;
        TMP_2._p = null;
        array = window.key;
        k = nil;
        now = (($a = $scope.Time) == null ? $opal.cm('Time') : $a).$new();
        return ($a = ($b = array).$delete_if, $a._p = (TMP_1 = function(a){var self = TMP_1._s || this, $a, $b, $c, time = nil, t = nil, i = nil;if (a == null) a = nil;
        if (($a = ($b = a != undefined, $b !== false && $b !== nil ?($c = a['$nil?'](), ($c === nil || $c === false)) : $b)) !== false && $a !== nil) {
            $a = $opal.to_ary(a), k = ($a[0] == null ? nil : $a[0]), time = ($a[1] == null ? nil : $a[1]);
            if (($a = ((($b = k != undefined) !== false && $b !== nil) ? $b : ($c = k['$nil?'](), ($c === nil || $c === false)))) !== false && $a !== nil) {
              t = [42, 34, 171, 187, 40, 41, 64, 43, 45, 47, 97, 98, 99, 100, 101, 102];
              i = t['$[]'](k);
              if ($opal.$yield1($yield, (($a = $scope.KeyDownEvent) == null ? $opal.cm('KeyDownEvent') : $a).$new(i)) === $breaker) return $breaker.$v;};
            return (now['$-'](time))['$>'](0.2);
            } else {
            return false
          }}, TMP_1._s = self, TMP_1), $a).call($b);
      }, nil)
    })(self, null);
    
  })(self)
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/rubygame.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $range = $opal.range, $hash2 = $opal.hash2;
  $opal.add_stubs(['$print', '$+', '$[]', '$*', '$==', '$read_nonblock', '$to_i', '$getc', '$include', '$size', '$/', '$new', '$map', '$zip', '$update', '$draw_box_s', '$every', '$-', '$<', '$clear', '$now', '$attr_accessor', '$each', '$is_a?', '$nil?', '$key', '$index', '$eq', '$eq=', '$block', '$sleep', '$unqueue', '$on_unblock', '$call', '$const_get', '$collect', '$to_proc', '$chars', '$concat', '$pause=', '$iterations=', '$log=', '$sound=', '$times', '$ready', '$pause', '$step', '$run', '$step=', '$run_multiple', '$run_instruction', '$>', '$beep', '$>>', '$&', '$get_current_key', '$[]=', '$each_with_index', '$push', '$^', '$write', '$delete_at', '$%', '$log', '$sprintf', '$parse_instruction_simple', '$printf', '$join', '$pop', '$===', '$|', '$include?', '$rand', '$draw', '$key_pressed', '$split']);
  (function($base, $super) {
    function $Terminal(){};
    var self = $Terminal = $klass($base, $super, 'Terminal', $Terminal);

    var def = $Terminal._proto, $scope = $Terminal._scope;
    def.$initialize = function(x, y) {
      var self = this;
      return nil;
    };

    def.$write = function(xy, c) {
      var self = this;
      return self.$print("0337033[" + (xy['$[]'](1)['$+'](1)) + ";" + (xy['$[]'](0)['$*'](2)) + "f033[" + (((function() {if (c['$=='](1)) {
        return 44
        } else {
        return 49
      }; return nil; })())) + "m  033[44m0338");
    };

    def.$beep = function() {
      var self = this;
      return self.$print("a");
    };

    return (def.$get_current_key = function(block) {
      var $a, self = this;
      if (block == null) {
        block = false
      }
      if (block !== false && block !== nil) {
        try {return (($a = $scope.STDIN) == null ? $opal.cm('STDIN') : $a).$read_nonblock(1) } catch ($err) { return nil }
        } else {
        return (($a = $scope.STDIN) == null ? $opal.cm('STDIN') : $a).$getc().$to_i()
      };
    }, nil);
  })(self, (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a));
  (function($base, $super) {
    function $Window(){};
    var self = $Window = $klass($base, $super, 'Window', $Window);

    var def = $Window._proto, $scope = $Window._scope, $a;
    def.dxy = def.screen = def.last_call = nil;
    ;

    self.$include((($a = $scope.Rubygame) == null ? $opal.cm('Rubygame') : $a));

    def.$initialize = function(x, y, w, h) {
      var $a, $b, TMP_1, self = this;
      if (w == null) {
        w = 800
      }
      if (h == null) {
        h = 600
      }
      if ((($a = $scope.ENV) == null ? $opal.cm('ENV') : $a).$size()['$=='](0)) {
        w = document.getElementById('screen').width;
        h = document.getElementById('screen').height;};
      self.dxy = [(w['$/'](x)), (h['$/'](y))];
      return self.screen = (($a = $scope.Screen) == null ? $opal.cm('Screen') : $a).$new(($a = ($b = self.dxy.$zip([x, y])).$map, $a._p = (TMP_1 = function(i, j){var self = TMP_1._s || this;if (i == null) i = nil;if (j == null) j = nil;
      return i['$*'](j)}, TMP_1._s = self, TMP_1), $a).call($b));
    };

    def.$write = function(xy, c) {
      var $a, $b, TMP_2, self = this, u = nil;
      u = ($a = ($b = [0, 1]).$map, $a._p = (TMP_2 = function(a){var self = TMP_2._s || this, $a, $b, TMP_3;
        if (self.dxy == null) self.dxy = nil;
if (a == null) a = nil;
      return ($a = ($b = xy.$zip(self.dxy)).$map, $a._p = (TMP_3 = function(i, j){var self = TMP_3._s || this;if (i == null) i = nil;if (j == null) j = nil;
        return (i['$+'](a))['$*'](j)}, TMP_3._s = self, TMP_3), $a).call($b)}, TMP_2._s = self, TMP_2), $a).call($b);
      return self.screen.$draw_box_s(u['$[]'](0), u['$[]'](1), [c['$*'](255)]['$*'](3)).$update();
    };

    def.$beep = function() {
      var $a, $b, TMP_4, self = this, dt = nil, int = nil, now = nil;
      if ((($a = $scope.ENV) == null ? $opal.cm('ENV') : $a).$size()['$=='](0)) {
        dt = 167;
        ((($a = (($b = $opal.cvars['@@beep_duration']) == null ? nil : $b)) !== false && $a !== nil) ? $a : ($opal.cvars['@@beep_duration'] = 0));
        var oscillator = undefined;
        if ((($a = $opal.cvars['@@beep_duration']) == null ? nil : $a)['$=='](0)) {
           audio = new AudioContext()
            oscillator = audio.createOscillator()
            oscillator.type = "triangle"
            oscillator.frequency.value = 440;
            oscillator.connect(audio.destination)
            oscillator.start(0);
                
          int = ($a = ($b = self).$every, $a._p = (TMP_4 = function(){var self = TMP_4._s || this, $a;
          ($opal.cvars['@@beep_duration'] = (($a = $opal.cvars['@@beep_duration']) == null ? nil : $a)['$-'](dt['$*'](2)));
            if ((($a = $opal.cvars['@@beep_duration']) == null ? nil : $a)['$<'](0)) {
              ($opal.cvars['@@beep_duration'] = 0);
              oscillator.stop(0);
              return self.$clear(int);
              } else {
              return nil
            };}, TMP_4._s = self, TMP_4), $a).call($b, dt);};
        now = (($a = $scope.Time) == null ? $opal.cm('Time') : $a).$now();
        ((($a = self.last_call) !== false && $a !== nil) ? $a : self.last_call = now);
        ($opal.cvars['@@beep_duration'] = (($a = $opal.cvars['@@beep_duration']) == null ? nil : $a)['$+'](((now['$-'](self.last_call))['$*'](1000)).$to_i()['$+'](1)));
        return self.last_call = now;
        } else {
        return nil
      };
    };

    self.$attr_accessor("eq", "block", "on_unblock");

    def.$unqueue = function(a) {
      var $a, $b, TMP_5, $c, $d, $e, self = this, i = nil, keys = nil;
      if (a == null) {
        a = self
      }
      i = nil;
      keys = [42, 34, 171, 187, 40, 41, 64, 43, 45, 47, 97, 98, 99, 100, 101, 102];
      ($a = ($b = (($c = a, ((($d = $c.$eq()) !== false && $d !== nil) ? $d : $c['$eq=']((($e = $scope.EventQueue) == null ? $opal.cm('EventQueue') : $e).$new()))))).$each, $a._p = (TMP_5 = function(e){var self = TMP_5._s || this, $a, $b, $c, $d;if (e == null) e = nil;
      if (($a = ($b = ($c = e['$is_a?']((($d = $scope.KeyDownEvent) == null ? $opal.cm('KeyDownEvent') : $d)), $c !== false && $c !== nil ?($d = e.$key()['$nil?'](), ($d === nil || $d === false)) : $c), $b !== false && $b !== nil ?($c = i = keys.$index(e.$key())['$nil?'](), ($c === nil || $c === false)) : $b)) !== false && $a !== nil) {
          return i = keys.$index(e.$key())
          } else {
          return nil
        }}, TMP_5._s = self, TMP_5), $a).call($b);
      if (($a = a.$block()) !== false && $a !== nil) {
        if (($a = i['$nil?']()) !== false && $a !== nil) {
          if ((($a = $scope.ENV) == null ? $opal.cm('ENV') : $a).$size()['$=='](0)) {
            setTimeout(function() { $opal.a.$unqueue($opal.a) }, 10);
            } else {
            self.$sleep(0.01);
            self.$unqueue(a);
          }
        } else if (($a = ($c = a.$on_unblock()['$nil?'](), ($c === nil || $c === false))) !== false && $a !== nil) {
          a.$on_unblock().$call(i)}};
      return i;
    };

    return (def.$get_current_key = function(block, on_unblock) {
      var $a, $b, self = this;
      if (block == null) {
        block = false
      }
      if (on_unblock == null) {
        on_unblock = nil
      }
      self.block = block;
      self.on_unblock = on_unblock;
      if (($a = ($b = block, ($b === nil || $b === false))) !== false && $a !== nil) {
        self.ready = true;
        return self.$unqueue();
      } else if ((($a = $scope.ENV) == null ? $opal.cm('ENV') : $a).$size()['$=='](0)) {
        $opal.a = self;
        return setTimeout(function() { $opal.a.$unqueue($opal.a) }, 10);
        } else {
        self.$sleep(0.01);
        return self.$unqueue(self);
      };
    }, nil);
  })(self, (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a));
  return (function($base, $super) {
    function $Emulator(){};
    var self = $Emulator = $klass($base, $super, 'Emulator', $Emulator);

    var def = $Emulator._proto, $scope = $Emulator._scope;
    def.width = def.height = def.mem = def.iterations = def.pc = def.t = def.DT = def.ST = def.sound = def.out = def.i = def.v = def['in'] = def.I = def.assembler = def.stack = nil;
    def.$initialize = function(str, ui) {
      var $a, $b, TMP_6, $c, $d, TMP_7, $e, self = this;
      self.width = 64;
      self.height = 32;
      self.video = self['in'] = self.out = (($a = $scope.Object) == null ? $opal.cm('Object') : $a).$const_get(ui).$new(self.width, self.height);
      self.mem = ($a = ($b = ($c = ($d = ("PJJJPCGCCHPBPIPPBPBPJJPBBPIPBPPIPJPPBCEEPJPJPPJPBPPJPJJOJOJOPIIIPOJJJOPIPIPPIPII").$chars()).$map, $c._p = "ord".$to_proc(), $c).call($d)).$collect, $a._p = (TMP_6 = function(x){var self = TMP_6._s || this;if (x == null) x = nil;
      return (x['$-'](65))['$*'](16)}, TMP_6._s = self, TMP_6), $a).call($b);
      self.mem = self.mem.$concat([0]['$*'](((self.pc = 512)['$-'](80)))).$concat(str);
      self.mem = self.mem.$concat([0]['$*'](1000));
      self.stack = self.v = ($a = ($c = (($e = $scope.Array) == null ? $opal.cm('Array') : $e)).$new, $a._p = (TMP_7 = function(){var self = TMP_7._s || this;
      return 0}, TMP_7._s = self, TMP_7), $a).call($c, 16);
      self.I = self.DT = self.ST = 0;
      self.ready = true;
      self.pause = false;
      self.step = false;
      self.log = false;
      self.sound = false;
      return self.iterations = 10;
    };

    self.$attr_accessor("ready", "pause", "step", "log", "iterations", "sound");

    def.$run_multiple = function(b) {
      var $a, $b, TMP_8, self = this;
      if (b == null) {
        b = self
      }
      if ((($a = $scope.ENV) == null ? $opal.cm('ENV') : $a).$size()['$=='](0)) {
        $opal.b = b;};
      if ((($a = $scope.ENV) == null ? $opal.cm('ENV') : $a).$size()['$=='](0)) {
        b['$pause='](document.getElementById('pause').getAttribute('class').indexOf('play') != -1);
        b['$iterations=']((document.getElementById('iterations').value).$to_i());
        b['$log='](document.getElementById('log').getAttribute('class').indexOf('file-o') != -1);
        b['$sound='](document.getElementById('sound').getAttribute('class').indexOf('volume-up') != -1);};
      ($a = ($b = self.iterations).$times, $a._p = (TMP_8 = function(){var self = TMP_8._s || this, $a, $b, $c, $d;
      if (($a = ($b = b.$ready(), $b !== false && $b !== nil ?(((($c = ($d = b.$pause(), ($d === nil || $d === false))) !== false && $c !== nil) ? $c : (($d = b.$pause(), $d !== false && $d !== nil ?b.$step() : $d)))) : $b)) !== false && $a !== nil) {
          return b.$run()
          } else {
          return nil
        }}, TMP_8._s = self, TMP_8), $a).call($b);
      b['$step='](false);
      if ((($a = $scope.ENV) == null ? $opal.cm('ENV') : $a).$size()['$=='](0)) {
        return setTimeout(function() {b.$run_multiple($opal.b)}, 10);
        } else {
        self.$sleep(0.01);
        return self.$run_multiple(b);
      };
    };

    def.$run = function() {
      var $a, $b, $c, $d, self = this;
      self.ready = true;
      if (($a = self.$run_instruction(self.i = self.mem['$[]'](self.pc['$+'](1))['$+'](self.mem['$[]'](self.pc)['$*'](256)))) !== false && $a !== nil) {
        self.pc = self.pc['$+'](2)};
      if (($a = ((($b = ($c = (($d = self['t'], $d != null && $d !== nil) ? 'instance-variable' : nil), ($c === nil || $c === false))) !== false && $b !== nil) ? $b : (($c = $scope.Time) == null ? $opal.cm('Time') : $c).$now()['$-'](self.t)['$>'](((1.0)['$/'](60))))) !== false && $a !== nil) {
        self.t = (($a = $scope.Time) == null ? $opal.cm('Time') : $a).$now();
        if (self.DT['$>'](0)) {
          self.DT = self.DT['$-'](1)};
        if ((self.ST = self.ST['$-'](1))['$>'](0)) {
          if (($a = self.sound) !== false && $a !== nil) {
            return self.out.$beep()
            } else {
            return nil
          }
          } else {
          return self.ST = 0
        };
        } else {
        return nil
      };
    };

    def.$key_pressed = function(mode, char$) {
      var $a, $b, $c, $d, self = this, f00 = nil, test = nil;
      if (char$ == null) {
        char$ = self['in'].$get_current_key()
      }
      f00 = (self.i['$&'](3840))['$>>'](((2)['$*'](4)));
      test = (((($a = char$['$nil?']()) !== false && $a !== nil) ? $a : ($b = char$.$to_i()['$=='](self.v['$[]'](f00)), ($b === nil || $b === false))));
      if (($a = (((($b = (($c = ($d = mode, ($d === nil || $d === false)), $c !== false && $c !== nil ?test : $c))) !== false && $b !== nil) ? $b : ((($c = mode !== false && mode !== nil) ? ($d = test, ($d === nil || $d === false)) : $c))))) !== false && $a !== nil) {
        return self.pc = self.pc['$+'](2)
        } else {
        return nil
      };
    };

    def.$draw = function() {
      var $a, $b, TMP_9, self = this, f = nil, f00 = nil, f0 = nil;
      self.v['$[]='](15, 0);
      f = self.i['$&'](15);
      f00 = (self.i['$&'](3840))['$>>'](8);
      f0 = (self.i['$&'](240))['$>>'](4);
      return ($a = ($b = self.mem['$[]']($range(self.I, (self.I['$+'](f)['$-'](1)), false))).$each_with_index, $a._p = (TMP_9 = function(line, dy){var self = TMP_9._s || this, $a, $b, TMP_10;if (line == null) line = nil;if (dy == null) dy = nil;
      return ($a = ($b = (8)).$times, $a._p = (TMP_10 = function(dx){var self = TMP_10._s || this, $a, $b, $c, xy = nil;
          if (self.v == null) self.v = nil;
          if (self.width == null) self.width = nil;
          if (self.height == null) self.height = nil;
          if (self.video == null) self.video = nil;
          if (self.out == null) self.out = nil;
if (dx == null) dx = nil;
        xy = [(self.v['$[]'](f00)['$+'](dx)), (self.v['$[]'](f0)['$+'](dy))];
          if (($a = ((($b = xy['$[]'](0)['$<'](self.width)) !== false && $b !== nil) ? $b : xy['$[]'](1)['$<'](self.height))) !== false && $a !== nil) {
            (($a = xy, $b = self.video, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, [0])))).$push(((line['$>>'](((7)['$-'](dx))))['$&'](1))['$^'](self.video['$[]'](xy)['$[]'](0)));
            self.out.$write(xy, self.video['$[]'](xy)['$[]'](1));
            if (($a = (($b = self.video['$[]'](xy).$delete_at(0)['$=='](1)) ? self.video['$[]'](xy)['$[]'](0)['$=='](0) : $b)) !== false && $a !== nil) {
              return self.v['$[]='](15, 1)
              } else {
              return nil
            };
            } else {
            return nil
          };}, TMP_10._s = self, TMP_10), $a).call($b)}, TMP_9._s = self, TMP_9), $a).call($b);
    };

    return (def.$run_instruction = function(i) {
      var $a, $b, TMP_11, $c, TMP_12, $d, $e, TMP_14, TMP_15, $f, TMP_16, $g, TMP_17, self = this, ins = nil, dis = nil, f000 = nil, f00 = nil, f0 = nil, f = nil, ff = nil, fff = nil, $case = nil, a = nil;
      ($a = ($b = (16)).$times, $a._p = (TMP_11 = function(k){var self = TMP_11._s || this;
        if (self.v == null) self.v = nil;
if (k == null) k = nil;
      return self.v['$[]='](k, self.v['$[]'](k)['$%'](256))}, TMP_11._s = self, TMP_11), $a).call($b);
      if (($a = self.$log()) !== false && $a !== nil) {
        ((($a = self.assembler) !== false && $a !== nil) ? $a : self.assembler = (($c = $scope.Assembler) == null ? $opal.cm('Assembler') : $c).$new());
        ins = self.$sprintf("%04x", i);
        dis = self.assembler.$parse_instruction_simple(ins);
        dis = dis['$+'](" "['$*'](((20)['$-'](dis.$size()))));
        self.$printf("run pc=%04d; i=%s; %s; v=[%s]; I=%d\n", self.pc, ins, dis, self.v.$join(", "), self.I);};
      f000 = (self.i['$&'](61440))['$>>'](((3)['$*'](4)));
      f00 = (self.i['$&'](3840))['$>>'](((2)['$*'](4)));
      f0 = (self.i['$&'](240))['$>>'](4);
      f = self.i['$&'](15);
      ff = self.i['$&'](255);
      fff = self.i['$&'](4095);
      if (i['$=='](0)) {
        return nil};
      if (i['$=='](224)) {
        ($a = ($c = self.width).$times, $a._p = (TMP_12 = function(x){var self = TMP_12._s || this, $a, $b, TMP_13;
          if (self.height == null) self.height = nil;
if (x == null) x = nil;
        return ($a = ($b = self.height).$times, $a._p = (TMP_13 = function(y){var self = TMP_13._s || this;
            if (self.out == null) self.out = nil;
if (y == null) y = nil;
          return self.out.$write([x, y], 0)}, TMP_13._s = self, TMP_13), $a).call($b)}, TMP_12._s = self, TMP_12), $a).call($c);
        self.video = $hash2([], {});};
      if (i['$=='](238)) {
        self.pc = self.stack.$pop()};
      $case = f000;if ((8)['$===']($case)) {$case = f;if ((0)['$===']($case)) {self.v['$[]='](f00, self.v['$[]'](f0))}else if ((1)['$===']($case)) {self.v['$[]='](f00, self.v['$[]'](f00)['$|'](self.v['$[]'](f0)))}else if ((2)['$===']($case)) {self.v['$[]='](f00, self.v['$[]'](f00)['$&'](self.v['$[]'](f0)))}else if ((3)['$===']($case)) {self.v['$[]='](f00, self.v['$[]'](f00)['$^'](self.v['$[]'](f0)))}else if ((4)['$===']($case)) {a = (self.v['$[]'](f0)['$+'](self.v['$[]'](f00)));
      self.v['$[]='](15, ((function() {if (($a = ($d = a['$==']((self.v['$[]='](f00, (a['$%'](256))))), ($d === nil || $d === false))) !== false && $a !== nil) {
        return 1
        } else {
        return 0
      }; return nil; })()));}else if ((5)['$===']($case)) {self.v['$[]='](15, (function() {if (self.v['$[]'](f00)['$>'](self.v['$[]'](f0))) {
        return 1
        } else {
        return 0
      }; return nil; })());
      self.v['$[]='](f00, self.v['$[]'](f00)['$-'](self.v['$[]'](f0)));}else if ((6)['$===']($case)) {self.v['$[]='](15, (self.v['$[]'](f00)['$&'](1)));
      self.v['$[]='](f00, self.v['$[]'](f00)['$/'](2));}else if ((14)['$===']($case)) {self.v['$[]='](15, ((self.v['$[]'](f00)['$&'](57344))['$>>'](15)));
      self.v['$[]='](f00, self.v['$[]'](f00)['$*'](2));}}else if ((1)['$===']($case) || (2)['$===']($case)) {if (($a = (f000['$=='](2))) !== false && $a !== nil) {
        self.stack.$push(self.pc)};
      self.pc = fff;
      return false;}else if ((3)['$===']($case) || (5)['$===']($case)) {if (self.v['$[]'](f00)['$=='](((function() {if (($a = [3, 4]['$include?'](f000)) !== false && $a !== nil) {
        return ff
        } else {
        return self.v['$[]'](f0)
      }; return nil; })()))) {
        self.pc = self.pc['$+'](2)}}else if ((4)['$===']($case) || (9)['$===']($case)) {if (($a = ($d = self.v['$[]'](f00)['$=='](((function() {if (($e = [3, 4]['$include?'](f000)) !== false && $e !== nil) {
        return ff
        } else {
        return self.v['$[]'](f0)
      }; return nil; })())), ($d === nil || $d === false))) !== false && $a !== nil) {
        self.pc = self.pc['$+'](2)}}else if ((6)['$===']($case)) {self.v['$[]='](f00, ff)}else if ((7)['$===']($case)) {($a = f00, $d = self.v, $d['$[]=']($a, $d['$[]']($a)['$+'](ff)))}else if ((11)['$===']($case)) {self.pc = fff['$+'](self.v['$[]'](0));
      return false;}else if ((12)['$===']($case)) {self.v['$[]='](f00, self.$rand(256)['$&'](ff))}else if ((10)['$===']($case)) {self.I = fff}else if ((13)['$===']($case)) {self.$draw()}else if ((14)['$===']($case)) {if (($a = [161, 158]['$include?'](ff)) !== false && $a !== nil) {
        self.$key_pressed(ff['$=='](158))}}else if ((15)['$===']($case)) {$case = ff;if ((30)['$===']($case)) {self.I = self.I['$+'](self.v['$[]'](f00))}else if ((10)['$===']($case)) {self.ready = false;
      self['in'].$get_current_key(true, ($a = ($d = (($e = $scope.Proc) == null ? $opal.cm('Proc') : $e)).$new, $a._p = (TMP_14 = function(e){var self = TMP_14._s || this;
        if (self.v == null) self.v = nil;
if (e == null) e = nil;
      self.v['$[]='](f00, e);
        return self.ready = true;}, TMP_14._s = self, TMP_14), $a).call($d));}else if ((21)['$===']($case)) {self.ST = self.v['$[]'](f00)}else if ((24)['$===']($case)) {self.DT = self.v['$[]'](f00)}else if ((41)['$===']($case)) {self.I = self.v['$[]'](f00)['$*'](5)}else if ((7)['$===']($case)) {self.v['$[]='](f00, self.DT)}else if ((51)['$===']($case)) {($a = ($e = self.$sprintf("%03d", self.v['$[]'](f00)).$split("")).$each_with_index, $a._p = (TMP_15 = function(v, x){var self = TMP_15._s || this;
        if (self.mem == null) self.mem = nil;
        if (self.I == null) self.I = nil;
if (v == null) v = nil;if (x == null) x = nil;
      return self.mem['$[]='](self.I['$+'](x), v)}, TMP_15._s = self, TMP_15), $a).call($e)}else if ((85)['$===']($case)) {($a = ($f = (f00['$+'](1))).$times, $a._p = (TMP_16 = function(x){var self = TMP_16._s || this;
        if (self.mem == null) self.mem = nil;
        if (self.I == null) self.I = nil;
        if (self.v == null) self.v = nil;
if (x == null) x = nil;
      return self.mem['$[]='](x['$+'](self.I), self.v['$[]'](x))}, TMP_16._s = self, TMP_16), $a).call($f)}else if ((101)['$===']($case)) {($a = ($g = (f00['$+'](1))).$times, $a._p = (TMP_17 = function(x){var self = TMP_17._s || this;
        if (self.v == null) self.v = nil;
        if (self.mem == null) self.mem = nil;
        if (self.I == null) self.I = nil;
if (x == null) x = nil;
      return self.v['$[]='](x, self.mem['$[]'](x['$+'](self.I)).$to_i())}, TMP_17._s = self, TMP_17), $a).call($g)}};
      return true;
    }, nil);
  })(self, null);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/emulator.js.map
;
/* Generated by Opal 0.5.5 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module, $klass = $opal.klass, $hash2 = $opal.hash2, $hash = $opal.hash;
  $opal.add_stubs(['$call', '$attr_accessor', '$output', '$parse', '$new', '$run_multiple', '$<<', '$unparse', '$join', '$map', '$sprintf', '$to_i', '$scan', '$split', '$fill_keyboard', '$setup', '$list', '$each', '$gsub', '$ord', '$reverse', '$decode', '$parameter', '$[]', '$+', '$encode', '$to_json', '$value', '$minify', '$value=', '$load_program', '$on', '$key_code', '$keys_push', '$nil?', '$/', '$-', '$page_x', '$width', '$target', '$page_y', '$height', '$every', '$*', '$focus', '$clear', '$send!', '$errback', '$p', '$callback', '$append', '$html', '$times', '$to_s', '$toggle', '$to_f', '$css', '$parent', '$==', '$check_uncheck', '$pause', '$html=', '$run2', '$include?', '$run']);
  ;
  ;
  ;
  ;
  (function($base) {
    var self = $module($base, 'Kernel');

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2;
    def.$clear = function(what) {
      var self = this;
      return clearInterval(what);
    };

    def.$every = TMP_1 = function(interval) {
      var self = this, $iter = TMP_1._p, block = $iter || nil, callback = nil;
      TMP_1._p = null;
      callback = function(){ block.$call(); };
      return setInterval(callback, interval);
    };

    def.$after = TMP_2 = function(interval) {
      var self = this, $iter = TMP_2._p, block = $iter || nil, callback = nil;
      TMP_2._p = null;
      callback = function(){ block.$call(); };
      return setTimeout(callback, interval);
    };
        ;$opal.donate(self, ["$clear", "$every", "$after"]);
  })(self);
  return (function($base, $super) {
    function $Runner(){};
    var self = $Runner = $klass($base, $super, 'Runner', $Runner);

    var def = $Runner._proto, $scope = $Runner._scope;
    def.emulator = def.special = nil;
    self.$attr_accessor("emulator");

    def.$run = function(text) {
      var $a, self = this, assembly = nil;
      assembly = (($a = $scope.Assembler) == null ? $opal.cm('Assembler') : $a).$new().$parse(text).$output();
      self.emulator = (($a = $scope.Emulator) == null ? $opal.cm('Emulator') : $a).$new(assembly, "Window");
      self.emulator.$run_multiple();
      return self.emulator;
    };

    def.$keys_push = function(k) {
      var $a, self = this;
      return (($a = $opal.cvars['@@keys']) == null ? nil : $a)['$<<']([k, (($a = $scope.Time) == null ? $opal.cm('Time') : $a).$new()]);
    };

    def.$disassemble = function(text) {
      var $a, self = this;
      return (($a = $scope.Assembler) == null ? $opal.cm('Assembler') : $a).$new().$unparse(text);
    };

    def.$assemble = function(text) {
      var $a, $b, TMP_3, $c, self = this;
      return ($a = ($b = (($c = $scope.Assembler) == null ? $opal.cm('Assembler') : $c).$new().$parse(text).$output()).$map, $a._p = (TMP_3 = function(x){var self = TMP_3._s || this;if (x == null) x = nil;
      return self.$sprintf("%02X", x)}, TMP_3._s = self, TMP_3), $a).call($b).$join();
    };

    def.$run2 = function(text) {
      var $a, $b, TMP_4, self = this, assembly = nil, e = nil;
      assembly = ($a = ($b = text.$split("\n").$join().$scan(/../)).$map, $a._p = (TMP_4 = function(s){var self = TMP_4._s || this;if (s == null) s = nil;
      return s.$to_i(16)}, TMP_4._s = self, TMP_4), $a).call($b);
      e = (($a = $scope.Emulator) == null ? $opal.cm('Emulator') : $a).$new(assembly, "Window");
      e.$run_multiple();
      return e;
    };

    def.$initialize = function() {
      var self = this;
      self.special = ["%", " ", ",", "/", "?", "=", "\n", ":", "{", "}", "\""];
      self.$fill_keyboard();
      self.$setup();
      return self.$list();
    };

    def.$encode = function(address) {
      var $a, $b, TMP_5, self = this;
      ($a = ($b = self.special).$each, $a._p = (TMP_5 = function(s){var self = TMP_5._s || this;if (s == null) s = nil;
      return address = address.$gsub(s, (self.$sprintf("%%%02X", s.$ord())))}, TMP_5._s = self, TMP_5), $a).call($b);
      return address;
    };

    def.$decode = function(address) {
      var $a, $b, TMP_6, self = this;
      ($a = ($b = self.special.$reverse()).$each, $a._p = (TMP_6 = function(s){var self = TMP_6._s || this;if (s == null) s = nil;
      return address = address.$gsub(self.$sprintf("%%%02X", s.$ord()), s)}, TMP_6._s = self, TMP_6), $a).call($b);
      return address;
    };

    def.$parameter = function() {
      var $a, self = this, pa = nil;
      pa = location.search.split('p=')[1];
      if (($a = pa == undefined) !== false && $a !== nil) {
        return false};
      return (($a = $scope.JSON) == null ? $opal.cm('JSON') : $a).$parse(self.$decode(pa));
    };

    def.$minify_program = function() {
      var $a, self = this, address = nil;
      address = location.href;
      if (($a = self.$parameter()) !== false && $a !== nil) {
        address = address.$split("?")['$[]'](0)};
      address = address['$+']("?p="['$+'](self.$encode($hash2(["title", "author", "date", "content"], {"title": (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#title").$value(), "author": (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#author").$value(), "date": (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#date").$value(), "content": (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#editor").$value()}).$to_json())));
      return self.$minify(address);
    };

    def.$load_program = function() {
      var $a, self = this;
      if (($a = self.$parameter()) !== false && $a !== nil) {
        return (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#editor")['$value='](self.$parameter()['$[]']("content"))
        } else {
        return nil
      };
    };

    def.$setup = function() {
      var $a, $b, TMP_7, $c, TMP_8, $d, TMP_10, $e, self = this, key_to_keypad_key = nil;
      ($opal.cvars['@@keys'] = []);
       window.key = (($a = $opal.cvars['@@keys']) == null ? nil : $a);
      self.$load_program();
      key_to_keypad_key = $hash(37, 4, 39, 6, 38, 2, 40, 8, 32, 5);
      ($a = ($b = (($c = $scope.Element) == null ? $opal.cm('Element') : $c)['$[]']("body")).$on, $a._p = (TMP_7 = function(e){var self = TMP_7._s || this, key = nil;if (e == null) e = nil;
      key = key_to_keypad_key['$[]'](e.$key_code());
        self.$keys_push(key);
        return key['$nil?']();}, TMP_7._s = self, TMP_7), $a).call($b, "keydown");
      ($a = ($c = (($d = $scope.Element) == null ? $opal.cm('Element') : $d)['$[]']("#screen")).$on, $a._p = (TMP_8 = function(e){var self = TMP_8._s || this, $a, $b, TMP_9, left = nil, top = nil, x = nil, y = nil;if (e == null) e = nil;
      left = e.$target().offset().left;
        top = e.$target().offset().top;
        x = (e.$page_x()['$-'](left))['$/'](e.$target().$width());
        y = (e.$page_y()['$-'](top))['$/'](e.$target().$height());
        return self.click = ($a = ($b = self).$every, $a._p = (TMP_9 = function(){var self = TMP_9._s || this, k = nil;
        k = (y['$*'](3)).$to_i()['$*'](3)['$+']((x['$*'](3)).$to_i())['$+'](1);
          return self.$keys_push(k);}, TMP_9._s = self, TMP_9), $a).call($b, 100);}, TMP_8._s = self, TMP_8), $a).call($c, "mousedown");
      return ($a = ($d = (($e = $scope.Element) == null ? $opal.cm('Element') : $e)['$[]']("#screen")).$on, $a._p = (TMP_10 = function(e){var self = TMP_10._s || this;
        if (self.click == null) self.click = nil;
if (e == null) e = nil;
      e.$target().$focus();
        return self.$clear(self.click);}, TMP_10._s = self, TMP_10), $a).call($d, "mouseup");
    };

    def.$minify = function(address) {
      var $a, $b, TMP_11, $c, $d, TMP_12, $e, self = this, opts = nil;
      opts = $hash2(["format", "payload"], {"format": "json", "payload": "apiKey=R_f857b8e18d6f401f917086b316e9f3de&login=c8tc8t&longUrl="['$+'](self.$encode(address))});
      return ($a = ($b = ($c = ($d = (($e = $scope.HTTP) == null ? $opal.cm('HTTP') : $e).$new("http://api.bitly.com/v3/shorten?callback=?", "POST", opts)).$callback, $c._p = (TMP_12 = function(response){var self = TMP_12._s || this, url = nil;if (response == null) response = nil;
      url = response.body.data.url;
        return alert("url: " + url);}, TMP_12._s = self, TMP_12), $c).call($d)).$errback, $a._p = (TMP_11 = function(a, b, c){var self = TMP_11._s || this;if (a == null) a = nil;if (b == null) b = nil;if (c == null) c = nil;
      return self.$p(a, b, c)}, TMP_11._s = self, TMP_11), $a).call($b)['$send!']();
    };

    ($opal.cvars['@@page'] = 1);

    def.$list = function(page) {
      var $a, self = this, opts = nil;
      if (page == null) {
        page = 1
      }
      
 window.parse_response = function(r)
 { window.runner.$parse_response(r); }
        
      opts = $hash2(["payload"], {"payload": "format=json&q="['$+'](self.$encode("select * from json where url=\"https://bitly.com/u/c8tc8t.json?page=" + (page) + "\""))});
      return (($a = $scope.HTTP) == null ? $opal.cm('HTTP') : $a).$new("http://query.yahooapis.com/v1/public/yql?callback=window.parse_response", "POST", opts)['$send!']();
    };

    def.$parse_response = function(response) {
      var $a, $b, TMP_13, $c, self = this, data = nil;
      if (($a = response.query.results.json.data != undefined) !== false && $a !== nil) {
        data = JSON.stringify(response.query.results.json.data);
        ($a = ($b = (($c = $scope.JSON) == null ? $opal.cm('JSON') : $c).$parse(data)).$each, $a._p = (TMP_13 = function(l){var self = TMP_13._s || this, $a, option_s = nil, option = nil;if (l == null) l = nil;
        option_s = l['$[]']("url").$split("?p=")['$[]'](1);
          option = (($a = $scope.JSON) == null ? $opal.cm('JSON') : $a).$parse(option_s);
          return (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#choose").$append("<option value='" + (option_s) + "'>" + (option['$[]']("title")) + "</option>");}, TMP_13._s = self, TMP_13), $a).call($b);
        ($opal.cvars['@@page'] = (($a = $opal.cvars['@@page']) == null ? nil : $a)['$+'](1));
        return self.$list((($a = $opal.cvars['@@page']) == null ? nil : $a));
        } else {
        return nil
      };
    };

    def.$writeHelp = function() {
      var $a, self = this;
      return (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#description").$html("This is a chip8 emulator.<br/>\nOn the right, you have an editor with the current program.<br/>\nYou can either erase it or (dis)assemble it.<br/>\nThe assembly is in hexadecimal.<br/>\nYou can start playing the current program with the play button.<br/>\nOnce started, the default program prints the current key pressed.\n<br/>\nKeys, from 0 to f, are available on the left.<br/>\nYou can pause, reload, fullscreen the current program.<br/>\nFinaly you can load ROMs via the upper left drop down menu.<br/>\nThe editor allows you to modify/write your own program.<br/>\nOnce your modification is done, just press the reload button.<br/>\nYou can pause the program, enable logging and playing it\nstep by step.<br/>\nSome usefull links:\n<ul><li><a href=http://www.chip8.com>chip8.com</a></li>\n<li><a href=http://devernay.free.fr/hacks/chip8/C8TECH10.HTM>\na really good description</a></li></ul>\n");
    };

    def.$goFullScreen = function() {
      var self = this;
       
        elem = document.getElementById("screen");
        if (elem.requestFullscreen) {
          elem.requestFullscreen();
          } else if (elem.msRequestFullscreen) {
              elem.msRequestFullscreen();
        } else if (elem.mozRequestFullScreen) {
              elem.mozRequestFullScreen();
        } else if (elem.webkitRequestFullscreen) {
              elem.webkitRequestFullscreen();
        }
        
      return nil;
    };

    def.$fill_keyboard = function() {
      var $a, $b, TMP_14, self = this, k = nil, html = nil;
      k = [1, 2, 3, 12, 4, 5, 6, 13, 7, 8, 9, 14, 10, 0, 11, 15];
      html = "";
      ($a = ($b = (4)).$times, $a._p = (TMP_14 = function(i){var self = TMP_14._s || this, $a, $b, TMP_15;if (i == null) i = nil;
      ($a = ($b = (4)).$times, $a._p = (TMP_15 = function(j){var self = TMP_15._s || this, s = nil;if (j == null) j = nil;
        s = k['$[]'](((4)['$*'](i)['$+'](j))).$to_s(16);
          return html = html['$+']("<input id='key' class='key key_" + (s) + "'\n                type='button' value='" + (s) + "' \n                onclick='window.runner.$keys_push(0x" + (s) + ")'/>");}, TMP_15._s = self, TMP_15), $a).call($b);
        return html = html['$+']("<br/>");}, TMP_14._s = self, TMP_14), $a).call($b);
      return (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#keyboard").$html(html);
    };

    def.$hide_show = function(g) {
      var $a, self = this, e = nil, screen_width = nil, show = nil, f = nil, _p = nil, size = nil;
      e = (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]'](g);
      e.$toggle();
      screen_width = e.$parent().$css("width").$to_f();
      show = ($a = e.$css("display")['$==']("none"), ($a === nil || $a === false));
      f = (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#screen_container");
      _p = f.$css("width").$to_f();
      _p = _p['$/'](screen_width);
      size = (_p['$+'](((function() {if (show !== false && show !== nil) {
        return -1
        } else {
        return 1
      }; return nil; })())['$*'](0.2)))['$*'](screen_width);
      f.$width(size);
      return (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#control").$width(size);
    };

    def.$check_uncheck = function(a, on, off) {
      var self = this, prefix = nil, e = nil;
      prefix = "control_button fa fa-2x fa-";
      e = self.emulator;
      
        if(a.getAttribute('class').indexOf(on) == -1) {
            a.setAttribute('class', prefix + on);
        }
        else {
            if(e == null) launch_hexa_or_source();
                a.setAttribute('class', prefix + off);
        }
      return nil;
    };

    def.$play_pause = function() {
      var $a, self = this;
      (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#big_play_button").$css($hash2(["visibility"], {"visibility": "hidden"}));
      return self.$check_uncheck(document.getElementById("pause"), "play", "pause");
    };

    def.$launch3 = function(select) {
      var $a, $b, TMP_16, self = this, game = nil, text = nil, description = nil;
      if (($a = ($b = self.emulator['$nil?'](), ($b === nil || $b === false))) !== false && $a !== nil) {
        self.emulator.$pause()};
      game = (($a = $scope.JSON) == null ? $opal.cm('JSON') : $a).$parse(select);
      ($a = ($b = ["title", "author", "date"]).$each, $a._p = (TMP_16 = function(i){var self = TMP_16._s || this, $a;if (i == null) i = nil;
      return (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#" + (i))['$value='](game['$[]'](i))}, TMP_16._s = self, TMP_16), $a).call($b);
      text = game['$[]']("content");
      (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#editor")['$value='](text);
      description = game['$[]']("description");
      if (($a = description['$nil?']()) !== false && $a !== nil) {
        description = ""};
      description = description.$gsub("\n", "<br/>");
      (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#description")['$html=']("        <b>" + (game['$[]']("title")) + "</b>, by " + (game['$[]']("author")) + "\n        in " + (game['$[]']("date")) + "<hr/>" + (description) + "\n");
      return self.$run2(text);
    };

    return (def.$launch_hexa_or_source = function() {
      var $a, $b, self = this, code = nil;
      if (($a = ($b = self.emulator['$nil?'](), ($b === nil || $b === false))) !== false && $a !== nil) {
        self.emulator.$pause()};
      code = (($a = $scope.Element) == null ? $opal.cm('Element') : $a)['$[]']("#editor").$value();
      if (($a = code['$include?'](" ")) !== false && $a !== nil) {
        return self.$run(code)
        } else {
        return self.$run2(code)
      };
    }, nil);
  })(self, null);
})(Opal);

//@ sourceMappingURL=/__opal_source_maps__/application.js.map
;
